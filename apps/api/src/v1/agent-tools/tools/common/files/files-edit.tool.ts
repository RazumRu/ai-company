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
import { OpenaiService } from '../../../../openai/openai.service';
import { zodToAjvSchema } from '../../../agent-tools.utils';
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
    .default(false)
    .describe(
      'Retry mode: use only if previous diff is not as expected or parsing/apply failed',
    ),
});

export type FilesEditToolSchemaType = z.input<typeof FilesEditToolSchema>;

// Zod schema for strict validation of LLM-proposed hunks
// Empty anchors ("") are allowed for BOF/EOF (beginning/end of file) cases
const ParsedHunkSchema = z.object({
  beforeAnchor: z.string().max(10000, 'beforeAnchor too long').default(''),
  afterAnchor: z.string().max(10000, 'afterAnchor too long').default(''),
  replacement: z.string().max(50000, 'replacement too long'),
  occurrence: z.number().int().positive().optional(),
});

const LLMResponseSchema = z.object({
  hunks: z.array(ParsedHunkSchema).min(1, 'Must have at least one hunk'),
});

type ParsedHunk = z.infer<typeof ParsedHunkSchema>;

type ParseResult = {
  success: boolean;
  hunks?: ParsedHunk[];
  warnings?: string[];
  error?: string;
  needsLLM?: boolean;
  usage?: RequestTokenUsage;
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
    'Apply sketch-based edits to a file using anchor markers. Call with useSmartModel=false first; if diff is wrong or parsing fails, retry with useSmartModel=true.';

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
    return zodToAjvSchema(FilesEditToolSchema);
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Apply sketch-based edits using \`// ... existing code ...\` markers as anchors. This is the PREFERRED primary editing tool.

      ### CRITICAL: Always Read File First
      **MANDATORY**: Use \`files_read\` before editing to get current content. NEVER edit without reading.
      - Prevents editing unknown/changed content
      - Ensures context for sketch-based edits
      - Validates file exists and is readable

      ### Model Selection Strategy
      - **ALWAYS start with useSmartModel=false** (default, fast, cheaper)
      - **If parsing fails or diff is not as expected**, retry with useSmartModel=true
      - The tool does NOT decide if the diff is correct - that's your job
      - Only use smart model after light model fails

      ### When to Use
      - Modifying existing files with sketch-style edits
      - Multiple related changes in one file
      - Adding imports + using them in same file
      - **PREFERRED as primary editing tool** (use before \`files_apply_changes\`)

      ### When NOT to Use
      - Creating new files → use \`files_write_file\`
      - Manual oldText/newText control → use \`files_apply_changes\`
      - File content unknown → use \`files_read\` first
      - Simple find-replace → use \`files_apply_changes\` with replaceAll

      ### Retry Strategy
      1. Call \`files_read\` to get current content (MANDATORY)
      2. Call \`files_edit\` with useSmartModel=false (default - fast, cheap)
      3. If fails: retry \`files_edit\` with useSmartModel=true (more accurate)
      4. If still fails: use \`files_apply_changes\` with exact oldText/newText from file

      ### Sketch Format

      Provide a "sketch" showing the **desired final state** with \`// ... existing code ...\` markers for unchanged sections:

      \`\`\`typescript
      // Good - shows what you want with markers for unchanged parts
      import { ServiceA } from './service-a';
      // ... existing code ...
      import { ServiceB } from './service-b';
      import { ServiceC } from './service-c';  // NEW import

      export class MyClass {
      // ... existing code ...
        method() {
          const result = newFunction();  // NEW line
          // ... existing code ...
        }
      }
      \`\`\`

      **Critical Rules:**
      1. Show the desired FINAL state (not just the changes)
      2. Use \`// ... existing code ...\` to mark sections you don't want to show
      3. Include enough context (3-8 lines) around changes so they're UNIQUE
      4. If similar code exists in multiple places, include MORE context (function names, class names)

      ### Examples

      **Example 1: Simple edit with default model**

      \`\`\`json
      {
        "filePath": "/workspace/src/user.service.ts",
        "editInstructions": "Add email validation before saving user",
        "codeSketch": "async saveUser(user: User) {\\n  if (!user.name) {\\n    throw new Error('Name required');\\n  }\\n// ... existing code ...\\n  if (!isValidEmail(user.email)) {\\n    throw new Error('Invalid email');\\n  }\\n// ... existing code ...\\n  return await this.repository.save(user);\\n}"
      }
      \`\`\`

      **Example 2: Retry with smart model after failure**

      \`\`\`json
      {
        "filePath": "/workspace/src/config.ts",
        "editInstructions": "Update API version and add timeout config",
        "codeSketch": "export const config = {\\n  apiVersion: '2.0',\\n// ... existing code ...\\n  timeout: 30000,\\n// ... existing code ...\\n};",
        "useSmartModel": true
      }
      \`\`\`
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

      // Track aggregated usage across all LLM calls
      let aggregatedUsage: RequestTokenUsage | undefined;

      // IMPORTANT: Do NOT use `dedent` on file/sketch contents — it destroys indentation.
      // Use fenced blocks to preserve whitespace exactly.
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
              'MARKERLESS SKETCH:',
              '- The sketch has NO "// ... existing code ..." markers.',
              '- Treat this as a FULL FILE REWRITE.',
              '- Return exactly ONE hunk with beforeAnchor="" and afterAnchor="".',
            ]),
        '',
        'EMPTY ANCHORS (for file boundaries):',
        '- beforeAnchor can be "" (empty) ONLY for prepending at the beginning of file (BOF)',
        '- afterAnchor can be "" (empty) ONLY for appending at the end of file (EOF)',
        '- Both empty ("" and "") means full file rewrite',
        '',
        'CRITICAL:',
        '1. Anchors MUST be exact copy/paste from CURRENT FILE above, including ALL leading spaces/tabs.',
        '   - If the file has "  return {", then the anchor MUST include those 2 leading spaces.',
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
        const result = await this.openaiService.response(
          { message },
          {
            model: this.llmModelsService.getFilesEditModel(useSmartModel),
            reasoning: {
              effort: 'low',
            },
            text: { verbosity: useSmartModel ? 'medium' : 'low' },
          },
        );

        // Aggregate usage
        if (result.usage) {
          aggregatedUsage =
            this.litellmService.sumTokenUsages([
              aggregatedUsage,
              result.usage,
            ]) ?? undefined;
        }

        return result.content ?? '';
      };

      const safeContent = await callLLM(prompt);

      // Parse clean JSON directly (no tags)
      const jsonString = String(safeContent).trim();
      if (!jsonString) {
        return {
          success: false,
          error: useSmartModel
            ? 'LLM returned empty response. Try files_apply_changes.'
            : 'LLM returned empty response. Try with useSmartModel=true.',
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonString);
      } catch (parseError) {
        return {
          success: false,
          error: useSmartModel
            ? `Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}. Try files_apply_changes.`
            : `Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}. Try with useSmartModel=true.`,
        };
      }

      // Validate with Zod schema
      const validation = LLMResponseSchema.safeParse(parsed);
      if (!validation.success) {
        const issues = validation.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        return {
          success: false,
          error: useSmartModel
            ? `Invalid hunk structure: ${issues}. Try files_apply_changes.`
            : `Invalid hunk structure: ${issues}. Try with useSmartModel=true or files_apply_changes.`,
        };
      }

      const hunks = validation.data.hunks;

      // Enforce markerless sketch = full rewrite (single hunk, empty anchors).
      // NOTE: `hasMarkers` is computed above when building the prompt.
      if (!hasMarkers) {
        if (hunks.length !== 1) {
          return {
            success: false,
            error: `Markerless sketch produced ${hunks.length} hunks, expected exactly 1 (full rewrite).`,
          };
        }
        const h = hunks[0];
        if (!h || h.beforeAnchor !== '' || h.afterAnchor !== '') {
          return {
            success: false,
            error:
              'Markerless sketch must be treated as full rewrite: expected beforeAnchor="" and afterAnchor="".',
          };
        }
      }

      // Retry once if the model violates basic invariants (commonly: identical anchors).
      const invalidReasons: string[] = [];
      for (const h of hunks) {
        // Empty strings are valid anchors for BOF/EOF/rewrite. Only missing fields are invalid.
        if (h.beforeAnchor === undefined || h.afterAnchor === undefined) {
          invalidReasons.push('Missing beforeAnchor/afterAnchor fields');
          continue;
        }
        // Identical anchors are invalid unless both are empty (full rewrite) or one is empty (BOF/EOF).
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
        if (bi === -1 || ai === -1) {
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
        const retryJsonString = retryContent.trim();

        if (!retryJsonString) {
          return {
            success: false,
            error: useSmartModel
              ? 'LLM retry returned empty response. Try files_apply_changes.'
              : 'LLM retry returned empty response. Try with useSmartModel=true.',
          };
        }

        let retryParsed: unknown;
        try {
          retryParsed = JSON.parse(retryJsonString);
        } catch {
          return {
            success: false,
            error: useSmartModel
              ? 'LLM retry returned invalid JSON. Try files_apply_changes.'
              : 'LLM retry returned invalid JSON. Try with useSmartModel=true.',
          };
        }

        const retryValidation = LLMResponseSchema.safeParse(retryParsed);
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
        };
      }

      return {
        success: true,
        hunks,
        warnings: warnings.length > 0 ? warnings : undefined,
        usage: aggregatedUsage,
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
    hunk: ParsedHunk,
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
      const pairs = this.findAllAnchorPairs(
        fileContent,
        hunk.beforeAnchor,
        hunk.afterAnchor,
      );

      if (pairs.length === 0) {
        // Provide a more specific error for the common case:
        // beforeAnchor exists, afterAnchor exists, but the span between them is too large.
        const beforeIdx = fileContent.indexOf(hunk.beforeAnchor);
        if (beforeIdx !== -1) {
          const afterSearchFrom = beforeIdx + hunk.beforeAnchor.length;
          const afterIdxAny = fileContent.indexOf(
            hunk.afterAnchor,
            afterSearchFrom,
          );
          if (afterIdxAny !== -1) {
            const end = afterIdxAny + hunk.afterAnchor.length;
            const span = end - beforeIdx;
            if (span > LIMITS.MAX_ANCHOR_SPAN_BYTES) {
              return {
                error: `Anchor span too large: ${span} bytes between beforeAnchor and afterAnchor exceeds ${LIMITS.MAX_ANCHOR_SPAN_BYTES} byte limit. Choose closer anchors or use files_apply_changes for large edits.`,
              };
            }
          }
        }
        return {
          error: `Could not find anchors in file. beforeAnchor: "${hunk.beforeAnchor.substring(0, 100)}...", afterAnchor: "${hunk.afterAnchor.substring(0, 100)}...". The anchors must be EXACT text from the current file. Try with useSmartModel=true or files_apply_changes if you know the exact oldText/newText.`,
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

      const desiredOccurrence = hunk.occurrence ?? 1;
      if (!Number.isInteger(desiredOccurrence) || desiredOccurrence < 1) {
        return {
          error: `Invalid occurrence value: ${String(hunk.occurrence)}. occurrence must be a positive integer.`,
        };
      }

      if (pairs.length > 1 && hunk.occurrence === undefined) {
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

      const newText = this.buildNewTextFromHunk(hunk, pair.kind);
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
