import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import type { RequestTokenUsage } from '../../../../litellm/litellm.types';
import { LitellmService } from '../../../../litellm/services/litellm.service';
import { LlmModelsService } from '../../../../litellm/services/llm-models.service';
import {
  CompleteJsonData,
  OpenaiService,
  ResponseJsonData,
} from '../../../../openai/openai.service';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

type EditKind = 'normal' | 'bof' | 'eof' | 'rewrite';

type AnchorPair = {
  start: number;
  end: number;
  matchedText: string;
  kind: EditKind;
  contextAnchor?: string; // For BOF/EOF validation
};

type EditOperation = {
  oldText: string;
  newText: string;
  start: number;
  end: number;
  kind: EditKind;
  contextAnchor?: string;
  hunkIndex: number;
};

const FilesEditToolSchema = z.object({
  filePath: z.string().min(1).describe('Path to the file to edit'),
  editInstructions: z.string().describe('Single sentence, first person'),
  codeSketch: z
    .string()
    .describe(
      'Precise edits with minimal unchanged context. Use // ... existing code ... marker to skip spans.',
    ),
  useSmartModel: z
    .boolean()
    .optional()
    .describe(
      'Retry mode: use only if previous diff is not as expected or parsing/apply failed',
    ),
});

export type FilesEditToolSchemaType = z.input<typeof FilesEditToolSchema>;

// Zod schema for strict validation of LLM-proposed hunks
// Empty anchors ("") are allowed for BOF/EOF (beginning/end of file) cases
const ParsedHunkSchema = z.object({
  beforeAnchor: z.string().default(''),
  afterAnchor: z.string().default(''),
  replacement: z.string(),
  occurrence: z.number().int().positive().nullable().default(null),
});

const LLMResponseSchema = z.object({
  hunks: z.array(ParsedHunkSchema).min(1, 'Must have at least one hunk'),
});

export type LLMResponseSchemaType = z.infer<typeof LLMResponseSchema>;

type ParsedHunk = z.input<typeof ParsedHunkSchema>;
type NormalizedHunk = {
  beforeAnchor: string;
  afterAnchor: string;
  replacement: string;
  occurrence: number | null;
};

type ParseResult = {
  success: boolean;
  hunks?: ParsedHunk[];
  warnings?: string[];
  error?: string;
  needsLLM?: boolean;
  usage?: RequestTokenUsage;
  markerlessViolation?: boolean;
};

type ErrorCode =
  | 'PARSE_FAILED'
  | 'NOT_FOUND_ANCHOR'
  | 'AMBIGUOUS_MATCH'
  | 'LIMIT_EXCEEDED'
  | 'APPLY_FAILED'
  | 'FILE_TOO_LARGE';

type SuggestedNextAction =
  | 'retry_with_smart_model'
  | 'add_more_context'
  | 'set_occurrence'
  | 'use_apply_changes';

type SuccessResponse = {
  success: true;
  filePath: string;
  diff: string;
  appliedHunks: number;
  modelUsed: 'light' | 'smart';
  warnings?: string[];
};

type ErrorResponse = {
  success: false;
  error: string;
  filePath: string;
  errorCode?: ErrorCode;
  modelUsed?: 'light' | 'smart';
  suggestedNextAction?: SuggestedNextAction;
  failedHunk?: ParsedHunk;
};

type FilesEditToolOutput = SuccessResponse | ErrorResponse;

const LIMITS = {
  MAX_FILE_BYTES: 1_000_000, // 1MB
  MAX_SKETCH_BYTES: 500_000, // 500KB
  // Practical LLM caps (far smaller than allowed file sizes). We do NOT send whole inputs to the model.
  MAX_LLM_FILE_CONTEXT_BYTES: 120_000, // 120KB
  MAX_LLM_SKETCH_CONTEXT_BYTES: 120_000, // 120KB
  MAX_LLM_PROMPT_BYTES: 220_000, // 220KB total prompt budget (approx)
  MAX_HUNKS: 20,
  MAX_DIFF_BYTES: 100_000, // 100KB
  MAX_ANCHOR_SPAN_BYTES: 100_000, // Max bytes between before/after anchors
  MAX_PAIRS_WITHOUT_OCCURRENCE: 1, // If > 1 pair found, occurrence required
  MAX_ANCHOR_PAIRS_PER_HUNK: 100, // Safety cap to avoid quadratic blow-ups
  BOF_EOF_CONTEXT_BYTES: 16_384, // 16KB - context validation for BOF/EOF
};

const ANCHOR_MARKER = '// ... existing code ...';

@Injectable()
export class FilesEditTool extends FilesBaseTool<FilesEditToolSchemaType> {
  public name = 'files_edit';
  public description =
    'Edit a file with a sketch of the desired result using "// ... existing code ..." markers. Best for complex multi-region edits. Requires files_read first.';

  constructor(
    private readonly openaiService: OpenaiService,
    private readonly litellmService: LitellmService,
    private readonly llmModelsService: LlmModelsService,
  ) {
    super();
  }

  protected override generateTitle(
    args: FilesEditToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const fileName = args.filePath.split('/').pop() || args.filePath;
    return `Editing ${fileName}`;
  }

  public get schema() {
    return FilesEditToolSchema;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Sketch-based edit tool for complex multi-region changes. Provide the desired final state using "// ... existing code ..." markers to skip unchanged sections.

      ### When to Use (prefer files_apply_changes for simple edits)
      - Multiple related changes in one file (e.g., add import + use it)
      - Structured edits where showing the final state is clearer than oldText/newText

      ### Sketch Rules
      - Show the final state, not a diff
      - Use "// ... existing code ..." to skip unchanged sections
      - Include 3-8 unique context lines around each change for reliable anchoring

      ### Retry Strategy
      1. Run \`files_read\` first (mandatory)
      2. Call with useSmartModel=false (default)
      3. If fails, retry with useSmartModel=true
      4. If still failing, fall back to \`files_apply_changes\`
    `;
  }

  private shQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
  }

  private validateSketchFormat(sketch: string): {
    valid: boolean;
    error?: string;
    warning?: string;
  } {
    // Markerless sketches are allowed (like Cursor) - treated as a full rewrite.
    // This avoids “best-effort anchors” which are often whitespace-normalized by the model.
    if (!sketch.includes(ANCHOR_MARKER)) {
      return {
        valid: true,
        warning: `Sketch has no "${ANCHOR_MARKER}" markers. This will be treated as a full file rewrite.`,
      };
    }

    return { valid: true };
  }

  private async parseLLM(
    fileContent: string,
    editInstructions: string,
    sketch: string,
    useSmartModel: boolean,
  ): Promise<ParseResult> {
    try {
      const { fileContext, sketchContext, warnings, error } =
        this.buildLLMContexts(fileContent, sketch);
      if (error) {
        return { success: false, error };
      }

      let aggregatedUsage: RequestTokenUsage | undefined;

      const hasMarkers = sketch.includes(ANCHOR_MARKER);
      const prompt = [
        'You are the LLM alignment step in a code editor. Your role: propose exact edit operations.',
        'A deterministic verifier will check and apply your proposals.',
        '',
        'CURRENT FILE:',
        '```',
        fileContext,
        '```',
        '',
        'SKETCH (desired final state, "// ... existing code ..." marks unchanged sections):',
        '```',
        sketchContext,
        '```',
        '',
        `USER INTENT: ${editInstructions}`,
        '',
        'YOUR JOB:',
        'Output edit operations (hunks) where each hunk specifies:',
        '- beforeAnchor: VERBATIM text from CURRENT FILE before the change',
        '- afterAnchor: VERBATIM text from CURRENT FILE after the change',
        '- replacement: exact new code from SKETCH that goes between the anchors (DO NOT include anchors)',
        '',
        ...(hasMarkers
          ? []
          : [
              'MARKERLESS SKETCH (NO "// ... existing code ..." markers):',
              '- Treat this as a FULL FILE REWRITE.',
              '- Output MUST be exactly ONE hunk.',
              '- That hunk MUST have beforeAnchor="" and afterAnchor="".',
              '- replacement MUST equal the entire sketch exactly.',
            ]),
        '',
        'EMPTY ANCHORS (for file boundaries):',
        '- beforeAnchor can be "" (empty) ONLY for prepending at the beginning of file (BOF)',
        '- afterAnchor can be "" (empty) ONLY for appending at the end of file (EOF)',
        '- Both empty ("" and "") means full file rewrite',
        '',
        'CRITICAL:',
        '1. Anchors MUST be exact copy/paste from CURRENT FILE above, including ALL leading spaces/tabs.',
        '2. Do NOT retype or “normalize” anchors. Extract them from CURRENT FILE exactly as shown.',
        '3. NEVER include new code in anchors (only in replacement).',
        '4. beforeAnchor and afterAnchor MUST be DIFFERENT (never identical) unless one is empty.',
        '5. afterAnchor MUST occur AFTER beforeAnchor in CURRENT FILE (unless empty).',
        '6. replacement MUST NOT contain beforeAnchor or afterAnchor text.',
        '',
        'EXAMPLE 1 (middle insert):',
        'CURRENT: "import A\\\\nexport class X {}"',
        'SKETCH: "import A\\\\n// ... existing code ...\\\\nimport B\\\\nexport class X {}"',
        'Output:',
        '{"hunks":[{"beforeAnchor":"import A","afterAnchor":"export class X {}","replacement":"import B"}]}',
        '',
        'EXAMPLE 2 (append to end):',
        "CURRENT: console.log('hello world');",
        "SKETCH: console.log('hello world');\\\\n// ... existing code ...\\\\nfunction greet() { return 'hi'; }",
        'Output:',
        '{"hunks":[{"beforeAnchor":"console.log(\'hello world\');","afterAnchor":"","replacement":"\\\\nfunction greet() { return \'hi\'; }"}]}',
        '',
        'EXAMPLE 3 (prepend to beginning):',
        "CURRENT: console.log('hello world');",
        "SKETCH: const os = require('os');\\\\nconsole.log('hello world');\\\\n// ... existing code ...",
        'Output:',
        '{"hunks":[{"beforeAnchor":"","afterAnchor":"console.log(\'hello world\');","replacement":"const os = require(\'os\');\\\\n"}]}',
        '',
        'EXAMPLE 4 (full rewrite):',
        'CURRENT: "old code"',
        'SKETCH: "completely new code"',
        'Output:',
        '{"hunks":[{"beforeAnchor":"","afterAnchor":"","replacement":"completely new code"}]}',
        '',
        'IMPORTANT: Return ONLY valid JSON, no other text.',
        'Output format:',
        '{"hunks":[{"beforeAnchor":"...","afterAnchor":"...","replacement":"...","occurrence":1}]}',
      ].join('\\n');

      const promptBytes = Buffer.byteLength(prompt, 'utf8');
      if (promptBytes > LIMITS.MAX_LLM_PROMPT_BYTES) {
        return {
          success: false,
          error:
            `LLM prompt too large (${(promptBytes / 1_000).toFixed(1)}KB). ` +
            `Provide a smaller sketch or use files_apply_changes for manual edits.`,
        };
      }

      const callLLM = async (message: string) => {
        const modelParams =
          await this.llmModelsService.getFilesEditParams(useSmartModel);
        const modelName =
          typeof modelParams.model === 'string'
            ? modelParams.model
            : String(modelParams.model);

        const supportsResponsesApi =
          await this.litellmService.supportsResponsesApi(modelName);

        const data: ResponseJsonData | CompleteJsonData = {
          model: modelName,
          message,
          json: true as const,
          jsonSchema: LLMResponseSchema,
          ...(modelParams.reasoning
            ? { reasoning: modelParams.reasoning }
            : {}),
        };

        const result = supportsResponsesApi
          ? await this.openaiService.response<LLMResponseSchemaType>(data)
          : await this.openaiService.complete<LLMResponseSchemaType>(data);

        if (result.usage) {
          aggregatedUsage =
            this.litellmService.sumTokenUsages([
              aggregatedUsage,
              result.usage,
            ]) ?? undefined;
        }

        return result.content;
      };

      const safeContent = await callLLM(prompt);

      if (!safeContent) {
        return { success: false, error: `LLM response is empty` };
      }

      const hunks = safeContent.hunks;

      let markerlessViolation = false;
      if (!hasMarkers) {
        if (
          hunks.length !== 1 ||
          hunks[0]?.beforeAnchor !== '' ||
          hunks[0]?.afterAnchor !== ''
        ) {
          markerlessViolation = true;
          warnings.push(
            'Markerless sketch expected full rewrite (one hunk with empty anchors). Will accept only if final file matches the sketch exactly.',
          );
        }
      }

      const invalidReasons: string[] = [];
      for (const h of hunks) {
        if (h.beforeAnchor === undefined || h.afterAnchor === undefined) {
          invalidReasons.push('Missing beforeAnchor/afterAnchor fields');
          continue;
        }
        if (
          h.beforeAnchor === h.afterAnchor &&
          h.beforeAnchor !== '' &&
          h.afterAnchor !== ''
        ) {
          invalidReasons.push('beforeAnchor and afterAnchor are identical');
          continue;
        }
        const bi = fileContent.indexOf(h.beforeAnchor);
        const ai =
          bi === -1
            ? -1
            : fileContent.indexOf(h.afterAnchor, bi + h.beforeAnchor.length);
        if (bi === -1 || (h.afterAnchor !== '' && ai === -1)) {
          invalidReasons.push(
            'Anchors not found in CURRENT FILE in correct order',
          );
        }
      }

      if (invalidReasons.length > 0) {
        const retryPrompt = `${prompt}\n\n${dedent`
        Your previous output was invalid:
        - ${Array.from(new Set(invalidReasons)).join('\n- ')}

        Fix and return JSON only in the same shape.
      `}`;

        const retryContent = await callLLM(retryPrompt);

        if (!retryContent) {
          return {
            success: false,
            error: useSmartModel
              ? 'LLM retry returned empty response. Try files_apply_changes.'
              : 'LLM retry returned empty response. Try with useSmartModel=true.',
          };
        }

        const retryValidation = LLMResponseSchema.safeParse(retryContent);
        if (!retryValidation.success) {
          return {
            success: false,
            error: useSmartModel
              ? 'LLM retry returned invalid hunk structure. Try files_apply_changes.'
              : 'LLM retry returned invalid hunk structure. Try with useSmartModel=true or files_apply_changes.',
          };
        }

        return {
          success: true,
          hunks: retryValidation.data.hunks,
          usage: aggregatedUsage,
          warnings: warnings.length > 0 ? warnings : undefined,
          markerlessViolation,
        };
      }

      return {
        success: true,
        hunks,
        warnings: warnings.length > 0 ? warnings : undefined,
        usage: aggregatedUsage,
        markerlessViolation,
      };
    } catch (error) {
      return {
        success: false,
        error: useSmartModel
          ? `${error instanceof Error ? error.message : String(error)}. Try files_apply_changes.`
          : `${error instanceof Error ? error.message : String(error)}. Try with useSmartModel=true.`,
      };
    }
  }

  private buildLLMContexts(
    fileContent: string,
    sketch: string,
  ): {
    fileContext: string;
    sketchContext: string;
    warnings: string[];
    error?: string;
  } {
    const warnings: string[] = [];
    const SAFETY_MARGIN = 0.6; // Use only 60% of budget

    // Calculate available budget after sketch
    const sketchBytes = Buffer.byteLength(sketch, 'utf8');
    const availableForFile = Math.floor(
      (LIMITS.MAX_LLM_PROMPT_BYTES - sketchBytes) * SAFETY_MARGIN,
    );

    if (availableForFile < 10000) {
      return {
        fileContext: '',
        sketchContext: sketch,
        warnings,
        error:
          'File too large for LLM context even with sketch. Use files_apply_changes.',
      };
    }

    const fileBytes = Buffer.byteLength(fileContent, 'utf8');

    // For files that fit in budget, send full content (no excerpts - Cursor-like behavior)
    if (fileBytes <= availableForFile) {
      return { fileContext: fileContent, sketchContext: sketch, warnings };
    }

    // Otherwise fail fast - no excerpts (Cursor-like behavior)
    return {
      fileContext: '',
      sketchContext: sketch,
      warnings,
      error: `File too large (${(fileBytes / 1000).toFixed(1)}KB) for LLM context. Use files_apply_changes for large files.`,
    };
  }

  /**
   * Pair-based matching:
   * - Handles empty anchors for BOF/EOF cases (insert/append/rewrite)
   * - beforeAnchor="" && afterAnchor="" → full rewrite (entire file)
   * - beforeAnchor="" → prepend (insert at BOF)
   * - afterAnchor="" → append (insert at EOF)
   * - Otherwise: find all occurrences of beforeAnchor and match with afterAnchor within max span
   */
  private findAllAnchorPairs(
    content: string,
    beforeAnchor: string,
    afterAnchor: string,
  ): AnchorPair[] {
    const pairs: AnchorPair[] = [];

    // Case 1: Full rewrite (both anchors empty)
    if (beforeAnchor === '' && afterAnchor === '') {
      return [
        {
          start: 0,
          end: content.length,
          matchedText: content,
          kind: 'rewrite',
        },
      ];
    }

    // Case 2: BOF insert (beforeAnchor empty, afterAnchor exists)
    // Zero-length insert at position 0 with context validation
    if (beforeAnchor === '') {
      const afterIdx = content.indexOf(afterAnchor);
      if (afterIdx === -1) return [];

      // Validate afterAnchor is near start (within 16KB)
      if (afterIdx > LIMITS.BOF_EOF_CONTEXT_BYTES) return [];

      return [
        {
          start: 0,
          end: 0, // Zero-length insert!
          matchedText: '',
          kind: 'bof',
          contextAnchor: afterAnchor,
        },
      ];
    }

    // Case 3: EOF append (afterAnchor empty, beforeAnchor exists)
    // Zero-length insert at end with context validation
    if (afterAnchor === '') {
      const beforeIdx = content.indexOf(beforeAnchor);
      if (beforeIdx === -1) return [];

      const afterBeforeAnchor = beforeIdx + beforeAnchor.length;
      const distanceFromEnd = content.length - afterBeforeAnchor;

      // Validate beforeAnchor is near end (within 16KB)
      if (distanceFromEnd > LIMITS.BOF_EOF_CONTEXT_BYTES) return [];

      return [
        {
          start: content.length,
          end: content.length, // Zero-length insert!
          matchedText: '',
          kind: 'eof',
          contextAnchor: beforeAnchor,
        },
      ];
    }

    // Case 4: Normal pairing (both anchors non-empty)
    if (beforeAnchor === afterAnchor) return pairs; // Can't match identical anchors

    let from = 0;
    while (from <= content.length) {
      const beforeIdx = content.indexOf(beforeAnchor, from);
      if (beforeIdx === -1) break;

      const afterSearchFrom = beforeIdx + beforeAnchor.length;
      const windowEnd = Math.min(
        content.length,
        beforeIdx + LIMITS.MAX_ANCHOR_SPAN_BYTES + afterAnchor.length,
      );

      let afterFrom = afterSearchFrom;
      while (afterFrom <= windowEnd) {
        const afterIdx = content.indexOf(afterAnchor, afterFrom);
        if (afterIdx === -1 || afterIdx > windowEnd) break;
        const end = afterIdx + afterAnchor.length;
        pairs.push({
          start: beforeIdx,
          end,
          matchedText: content.slice(beforeIdx, end),
          kind: 'normal',
        });
        if (pairs.length >= LIMITS.MAX_ANCHOR_PAIRS_PER_HUNK) {
          return pairs;
        }
        afterFrom = afterIdx + 1;
      }

      from = beforeIdx + 1;
    }

    return pairs;
  }

  private buildNewTextFromHunk(
    hunk: NormalizedHunk,
    kind: EditKind,
  ): string | null {
    // Validate replacement doesn't contain anchors (for strong anchors)
    const shouldGuardAnchor = (anchor: string) =>
      anchor.includes('\n') || anchor.length >= 20;

    // For rewrite/bof/eof, return ONLY replacement (no anchors)
    if (kind === 'rewrite' || kind === 'bof' || kind === 'eof') {
      return hunk.replacement;
    }

    // For normal edits, include anchors but NO auto-newlines
    if (
      (shouldGuardAnchor(hunk.beforeAnchor) &&
        hunk.replacement.includes(hunk.beforeAnchor)) ||
      (shouldGuardAnchor(hunk.afterAnchor) &&
        hunk.replacement.includes(hunk.afterAnchor))
    ) {
      return null;
    }

    // NO auto-newlines - just concatenate exactly as-is
    return hunk.beforeAnchor + hunk.replacement + hunk.afterAnchor;
  }

  private normalizeHunk(hunk: ParsedHunk): NormalizedHunk {
    return {
      beforeAnchor: hunk.beforeAnchor ?? '',
      afterAnchor: hunk.afterAnchor ?? '',
      replacement: hunk.replacement,
      occurrence: hunk.occurrence ?? null,
    };
  }

  private resolveHunksToEdits(
    fileContent: string,
    hunks: ParsedHunk[],
  ): {
    edits?: EditOperation[];
    error?: string;
  } {
    const edits: EditOperation[] = [];

    for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex++) {
      const hunk = hunks[hunkIndex]!;
      const normalized = this.normalizeHunk(hunk);
      const pairs = this.findAllAnchorPairs(
        fileContent,
        normalized.beforeAnchor,
        normalized.afterAnchor,
      );

      if (pairs.length === 0) {
        // Provide a more specific error for the common case:
        // beforeAnchor exists, afterAnchor exists, but the span between them is too large.
        const beforeIdx = fileContent.indexOf(normalized.beforeAnchor);
        if (beforeIdx !== -1) {
          const afterSearchFrom = beforeIdx + normalized.beforeAnchor.length;
          const afterIdxAny = fileContent.indexOf(
            normalized.afterAnchor,
            afterSearchFrom,
          );
          if (afterIdxAny !== -1) {
            const end = afterIdxAny + normalized.afterAnchor.length;
            const span = end - beforeIdx;
            if (span > LIMITS.MAX_ANCHOR_SPAN_BYTES) {
              return {
                error: `Anchor span too large: ${span} bytes between beforeAnchor and afterAnchor exceeds ${LIMITS.MAX_ANCHOR_SPAN_BYTES} byte limit. Choose closer anchors or use files_apply_changes for large edits.`,
              };
            }
          }
        }
        return {
          error: dedent`
            Could not find anchors in file.

            beforeAnchor: "${normalized.beforeAnchor.substring(0, 80)}..."
            afterAnchor: "${normalized.afterAnchor.substring(0, 80)}..."

            SUGGESTED ACTIONS:
            1. Run files_read first to get current file content
            2. Ensure your codeSketch anchors match EXACT text in the file
            3. Include more unique context (function names, imports, comments)

            Alternative: Use files_apply_changes with exact oldText/newText copied from files_read output.

            If this is a retry, try useSmartModel=true for better anchor extraction.
          `,
        };
      }

      // Validate anchor span: reject pairs with excessive span (skip for BOF/EOF/rewrite)
      for (const pair of pairs) {
        if (pair.kind === 'normal') {
          const span = pair.end - pair.start;
          if (span > LIMITS.MAX_ANCHOR_SPAN_BYTES) {
            return {
              error: `Anchor span too large: ${span} bytes between beforeAnchor and afterAnchor exceeds ${LIMITS.MAX_ANCHOR_SPAN_BYTES} byte limit. Choose closer anchors or use files_apply_changes for large edits.`,
            };
          }
        }
      }

      const desiredOccurrence = normalized.occurrence ?? 1;
      if (!Number.isInteger(desiredOccurrence) || desiredOccurrence < 1) {
        return {
          error: `Invalid occurrence value: ${String(normalized.occurrence)}. occurrence must be a positive integer.`,
        };
      }

      if (pairs.length > 1 && normalized.occurrence === null) {
        return {
          error: `Ambiguous anchors: found ${pairs.length} valid before→after pairs. Use more unique anchors (prefer multi-line), or provide "occurrence" to select which match to edit.`,
        };
      }

      const pair = pairs[desiredOccurrence - 1];
      if (!pair) {
        return {
          error: `occurrence ${desiredOccurrence} is out of range. Only ${pairs.length} valid matches found.`,
        };
      }

      const newText = this.buildNewTextFromHunk(normalized, pair.kind);
      if (!newText) {
        return {
          error:
            'Invalid hunk: replacement must not include beforeAnchor/afterAnchor. Ask the model to put anchors ONLY in beforeAnchor/afterAnchor and keep replacement anchor-free.',
        };
      }

      edits.push({
        oldText: pair.matchedText,
        newText,
        start: pair.start,
        end: pair.end,
        kind: pair.kind,
        contextAnchor: pair.contextAnchor,
        hunkIndex,
      });
    }

    // Check for overlapping edits
    const ranges = edits
      .map((e, idx) => ({ idx, start: e.start, end: e.end }))
      .sort((a, b) => a.start - b.start);
    for (let i = 0; i < ranges.length - 1; i++) {
      const a = ranges[i]!;
      const b = ranges[i + 1]!;
      if (a.end > b.start) {
        return {
          error: `Overlapping edits detected: hunks ${a.idx} and ${b.idx} overlap. Ensure hunks target non-overlapping regions of the file.`,
        };
      }
    }

    return { edits };
  }

  private checkLimits(
    fileContent: string,
    edits: EditOperation[],
  ): {
    ok: boolean;
    error?: string;
  } {
    // File size check
    const fileBytes = Buffer.byteLength(fileContent, 'utf8');
    if (fileBytes > LIMITS.MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `File size ${(fileBytes / 1_000_000).toFixed(2)}MB exceeds ${LIMITS.MAX_FILE_BYTES / 1_000_000}MB limit. Use files_apply_changes for large files or split into smaller edits.`,
      };
    }

    // Hunks count check
    if (edits.length > LIMITS.MAX_HUNKS) {
      return {
        ok: false,
        error: `${edits.length} hunks exceeds ${LIMITS.MAX_HUNKS} limit. Break changes into multiple files_edit calls with fewer hunks each.`,
      };
    }

    return { ok: true };
  }

  private truncateDiff(diff: string, maxBytes: number): string {
    const diffBytes = Buffer.byteLength(diff, 'utf8');
    if (diffBytes <= maxBytes) {
      return diff;
    }

    // Truncate to maxBytes
    let truncated = diff.substring(0, maxBytes);
    // Find last newline to avoid cutting mid-line
    const lastNewline = truncated.lastIndexOf('\n');
    if (lastNewline > 0) {
      truncated = truncated.substring(0, lastNewline);
    }

    return `${truncated}\n... (diff truncated to ${maxBytes} bytes) ...`;
  }

  /**
   * Applies all edits to file content in memory atomically
   */
  private applyAllEditsAtomically(
    fileContent: string,
    edits: EditOperation[],
  ): string {
    // Sort: bottom-to-top by start (desc), then by hunkIndex (asc) for ties
    const sorted = [...edits].sort((a, b) => {
      if (a.start !== b.start) {
        return b.start - a.start; // Larger start first (bottom-to-top)
      }
      return a.hunkIndex - b.hunkIndex; // For same position, original order
    });

    let result = fileContent;

    for (const edit of sorted) {
      // For BOF/EOF, validate context anchor is still present and near boundary
      if (edit.kind === 'bof' && edit.contextAnchor) {
        const idx = result.indexOf(edit.contextAnchor);
        if (idx === -1 || idx > LIMITS.BOF_EOF_CONTEXT_BYTES) {
          throw new Error('BOF context anchor not found or too far from start');
        }
      }

      if (edit.kind === 'eof' && edit.contextAnchor) {
        const idx = result.lastIndexOf(edit.contextAnchor);
        if (idx === -1 || result.length - idx > LIMITS.BOF_EOF_CONTEXT_BYTES) {
          throw new Error('EOF context anchor not found or too far from end');
        }
      }

      // For normal/rewrite, validate oldText matches
      if (edit.kind === 'normal' || edit.kind === 'rewrite') {
        const currentSlice = result.slice(edit.start, edit.end);
        if (currentSlice !== edit.oldText) {
          throw new Error(
            `Could not find match for oldText at expected range during apply`,
          );
        }
      }

      result =
        result.slice(0, edit.start) + edit.newText + result.slice(edit.end);
    }

    return result;
  }

  /**
   * Generates unified diff for display
   */
  private generateUnifiedDiff(
    originalContent: string,
    modifiedContent: string,
    edits: EditOperation[],
  ): string {
    const originalLines = originalContent.split('\n');

    const diffLines: string[] = [];

    for (const edit of edits) {
      const oldTextLines = edit.oldText.split('\n');
      const newTextLines = edit.newText.split('\n');

      // Use captured start index to compute line number (no searching!)
      const contentBeforeEdit = originalContent.substring(0, edit.start);
      const startLine = contentBeforeEdit.split('\n').length - 1;

      diffLines.push(
        `@@ -${startLine + 1},${oldTextLines.length} +${startLine + 1},${newTextLines.length} @@`,
      );

      // Show 2 lines of context before
      for (let i = Math.max(0, startLine - 2); i < startLine; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffLines.push(` ${line}`);
        }
      }

      // Show removed lines
      for (const line of oldTextLines) {
        diffLines.push(`-${line}`);
      }

      // Show added lines
      for (const line of newTextLines) {
        diffLines.push(`+${line}`);
      }

      // Show 2 lines of context after
      for (
        let i = startLine + oldTextLines.length;
        i < Math.min(originalLines.length, startLine + oldTextLines.length + 2);
        i++
      ) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffLines.push(` ${line}`);
        }
      }

      diffLines.push('');
    }

    return diffLines.join('\n');
  }

  public async invoke(
    args: FilesEditToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesEditToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const p = this.shQuote(args.filePath);

    const readResult = await this.execCommand({ cmd: `cat ${p}` }, config, cfg);
    if (readResult.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: `${readResult.stderr || 'Failed to read file'}. Verify the file exists and is readable.`,
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    const fileContent = readResult.stdout;

    const fileBytes = Buffer.byteLength(fileContent, 'utf8');
    if (fileBytes > LIMITS.MAX_FILE_BYTES) {
      return {
        output: {
          success: false,
          error: `File size ${(fileBytes / 1_000_000).toFixed(2)}MB exceeds ${LIMITS.MAX_FILE_BYTES / 1_000_000}MB limit. Use files_apply_changes for large files.`,
          filePath: args.filePath,
          errorCode: 'FILE_TOO_LARGE',
          suggestedNextAction: 'use_apply_changes',
        },
        messageMetadata,
      };
    }

    const sketchBytes = Buffer.byteLength(args.codeSketch, 'utf8');
    if (sketchBytes > LIMITS.MAX_SKETCH_BYTES) {
      return {
        output: {
          success: false,
          error: `Sketch size ${(sketchBytes / 1_000).toFixed(1)}KB exceeds ${LIMITS.MAX_SKETCH_BYTES / 1_000}KB limit. Provide a shorter sketch with fewer changes.`,
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    const sketchValidation = this.validateSketchFormat(args.codeSketch);
    if (!sketchValidation.valid) {
      return {
        output: {
          success: false,
          error: sketchValidation.error!,
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    // Early no-op detection for markerless sketches (full file rewrite that matches current content)
    if (!args.codeSketch.includes(ANCHOR_MARKER)) {
      const normalizeForNoopCheck = (s: string) => {
        const t = s.replace(/\r\n/g, '\n').trim();
        return t;
      };
      const normalizedSketch = normalizeForNoopCheck(args.codeSketch);
      const normalizedFile = normalizeForNoopCheck(fileContent);
      if (normalizedSketch === normalizedFile) {
        return {
          output: {
            success: false,
            error:
              'Sketch is identical to current file content - no changes would be made.',
            filePath: args.filePath,
          },
          messageMetadata,
        };
      }
    }

    const useSmartModel = args.useSmartModel ?? false;

    const parseResult = await this.parseLLM(
      fileContent,
      args.editInstructions,
      args.codeSketch,
      useSmartModel,
    );

    if (!parseResult.success || !parseResult.hunks) {
      return {
        output: {
          success: false,
          error:
            parseResult.error ||
            'Failed to parse sketch. Try with useSmartModel=true.',
          filePath: args.filePath,
          errorCode: 'PARSE_FAILED',
          modelUsed: useSmartModel ? 'smart' : 'light',
          suggestedNextAction: useSmartModel
            ? 'use_apply_changes'
            : 'retry_with_smart_model',
        },
        messageMetadata,
      };
    }

    const { edits, error } = this.resolveHunksToEdits(
      fileContent,
      parseResult.hunks,
    );
    if (error) {
      const isAnchorError =
        error.includes('Could not find anchors') ||
        error.includes('Ambiguous anchors');
      return {
        output: {
          success: false,
          error,
          filePath: args.filePath,
          errorCode: isAnchorError ? 'NOT_FOUND_ANCHOR' : 'APPLY_FAILED',
          modelUsed: useSmartModel ? 'smart' : 'light',
          suggestedNextAction: useSmartModel
            ? 'use_apply_changes'
            : isAnchorError
              ? 'retry_with_smart_model'
              : 'add_more_context',
        },
        messageMetadata,
      };
    }

    if (!edits || edits.length === 0) {
      return {
        output: {
          success: false,
          error:
            'No edits could be resolved from hunks. Check your sketch format and anchors.',
          filePath: args.filePath,
          errorCode: 'APPLY_FAILED',
          modelUsed: useSmartModel ? 'smart' : 'light',
          suggestedNextAction: useSmartModel
            ? 'use_apply_changes'
            : 'retry_with_smart_model',
        },
        messageMetadata,
      };
    }

    const limitCheck = this.checkLimits(fileContent, edits);
    if (!limitCheck.ok) {
      return {
        output: {
          success: false,
          error:
            limitCheck.error || 'Limit exceeded. Break into smaller changes.',
          filePath: args.filePath,
          errorCode: 'LIMIT_EXCEEDED',
          modelUsed: useSmartModel ? 'smart' : 'light',
          suggestedNextAction: 'use_apply_changes',
        },
        messageMetadata,
      };
    }

    let modifiedContent: string;
    try {
      modifiedContent = this.applyAllEditsAtomically(fileContent, edits);
    } catch (applyError) {
      return {
        output: {
          success: false,
          error: `${applyError instanceof Error ? applyError.message : String(applyError)}. Try files_apply_changes with manual oldText/newText.`,
          filePath: args.filePath,
          errorCode: 'APPLY_FAILED',
          modelUsed: useSmartModel ? 'smart' : 'light',
          suggestedNextAction: useSmartModel
            ? 'use_apply_changes'
            : 'retry_with_smart_model',
        },
        messageMetadata,
      };
    }

    const hasMarkers = args.codeSketch.includes(ANCHOR_MARKER);

    const normalizeForCompare = (s: string) => {
      const t = s.replace(/\r\n/g, '\n');
      return t.endsWith('\n') ? t.slice(0, -1) : t;
    };

    if (!hasMarkers) {
      const sketchNorm = normalizeForCompare(args.codeSketch);
      const modifiedNorm = normalizeForCompare(modifiedContent);

      if (modifiedNorm !== sketchNorm) {
        return {
          output: {
            success: false,
            error:
              'Markerless sketch requires the final file to match the sketch exactly. The applied edits did not produce the sketch result.',
            filePath: args.filePath,
            errorCode: 'APPLY_FAILED',
            modelUsed: useSmartModel ? 'smart' : 'light',
            suggestedNextAction: useSmartModel
              ? 'use_apply_changes'
              : 'retry_with_smart_model',
          },
          messageMetadata,
          toolRequestUsage: parseResult.usage,
        };
      }
    }

    const diff = this.generateUnifiedDiff(fileContent, modifiedContent, edits);

    const contentBase64 = Buffer.from(modifiedContent, 'utf8').toString(
      'base64',
    );
    const tempFile = `${args.filePath}.tmp.${Date.now()}.${randomBytes(4).toString('hex')}`;
    const writeCmd = `printf %s ${this.shQuote(contentBase64)} | base64 -d > ${this.shQuote(tempFile)} && mv ${this.shQuote(tempFile)} ${this.shQuote(args.filePath)}`;

    const writeResult = await this.execCommand({ cmd: writeCmd }, config, cfg);
    if (writeResult.exitCode !== 0) {
      await this.execCommand(
        { cmd: `rm -f ${this.shQuote(tempFile)}` },
        config,
        cfg,
      ).catch(() => {});

      return {
        output: {
          success: false,
          error: `${writeResult.stderr || 'Failed to write file'}. Check file permissions and disk space.`,
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    return {
      output: {
        success: true,
        filePath: args.filePath,
        diff: this.truncateDiff(diff, LIMITS.MAX_DIFF_BYTES),
        appliedHunks: edits.length,
        modelUsed: useSmartModel ? 'smart' : 'light',
        warnings: parseResult.warnings,
      },
      messageMetadata,
      toolRequestUsage: parseResult.usage,
    };
  }
}
