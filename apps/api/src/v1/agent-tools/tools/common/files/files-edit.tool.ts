import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { environment } from '../../../../../environments';
import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { OpenaiService } from '../../../../openai/openai.service';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

type EditOperation = {
  oldText: string;
  newText: string;
  start: number;
  end: number;
};

const FilesEditToolSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe('Absolute path to file (sandboxed to workspace root)'),
  editInstructions: z
    .string()
    .describe('High-level description of changes to make'),
  codeSketch: z
    .string()
    .describe(
      'Sketch with // ... existing code ... markers showing changes in context',
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
};

type SuccessResponse = {
  success: true;
  filePath: string;
  diff: string;
  appliedHunks: number;
};

type ErrorResponse = {
  success: false;
  error: string;
  filePath: string;
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
  MAX_CHANGED_LINES_RATIO: 0.5, // 50% of file
  // Anchor strength requirements
  MIN_ANCHOR_LINES: 2, // Anchors must span at least 2 lines
  MIN_SINGLELINE_ANCHOR_CHARS: 80, // Allow 1-line anchors only if they are "strong" (or a file boundary anchor)
  MAX_ANCHOR_SPAN_BYTES: 50_000, // Max bytes between before/after anchors
  MAX_PAIRS_WITHOUT_OCCURRENCE: 1, // If > 1 pair found, occurrence required
  MAX_ANCHOR_PAIRS_PER_HUNK: 100, // Safety cap to avoid quadratic blow-ups
};

const ANCHOR_MARKER = '// ... existing code ...';

export type FilesEditToolConfig = FilesBaseToolConfig & {
  // Model selection is controlled via env config (FILES_EDIT_MODEL / FILES_EDIT_REASONING_EFFORT).
};

@Injectable()
export class FilesEditTool extends FilesBaseTool<FilesEditToolSchemaType> {
  public name = 'files_edit';
  public description =
    'Apply sketch-based edits to a file using anchor markers (primary editing tool with smart parsing).';

  constructor(private readonly openaiService: OpenaiService) {
    super();
  }

  protected override generateTitle(
    args: FilesEditToolSchemaType,
    _config: FilesEditToolConfig,
  ): string {
    const fileName = args.filePath.split('/').pop() || args.filePath;
    return `Editing ${fileName} (sketch-based)`;
  }

  public get schema() {
    return z.toJSONSchema(FilesEditToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public getDetailedInstructions(
    _config: FilesEditToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Apply sketch-based edits using \`// ... existing code ...\` markers as anchors. This is the PREFERRED primary editing tool.

      ### When to Use
      - Modifying existing files with sketch-style edits
      - Multiple related changes in one file
      - **PREFERRED as primary editing tool** (use before \`files_apply_changes\`)

      ### When NOT to Use
      - Creating new files → use \`files_write_file\`
      - Need manual oldText/newText control → use \`files_apply_changes\`
      - File content unknown → use \`files_read\` first

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

      ### Error Handling

      On failure, the tool returns an \`error\` message that explains what went wrong and suggests what to try next. If needed, retry with \`files_edit_reapply\` (smarter parsing) or use \`files_apply_changes\` for manual oldText/newText edits.

      ### Examples

      **Example 1: Simple edit with good context**

      \`\`\`json
      {
        "filePath": "/workspace/src/user.service.ts",
        "editInstructions": "Add email validation before saving user",
        "codeSketch": "async saveUser(user: User) {\\n  if (!user.name) {\\n    throw new Error('Name required');\\n  }\\n// ... existing code ...\\n  if (!isValidEmail(user.email)) {\\n    throw new Error('Invalid email');\\n  }\\n// ... existing code ...\\n  return await this.repository.save(user);\\n}"
      }
      \`\`\`

      **Example 2: Multiple hunks**

      \`\`\`json
      {
        "filePath": "/workspace/src/config.ts",
        "editInstructions": "Update API version and add timeout config",
        "codeSketch": "export const config = {\\n  apiVersion: '2.0',\\n// ... existing code ...\\n  timeout: 30000,\\n// ... existing code ...\\n};"
      }
      \`\`\`
    `;
  }

  private shQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
  }

  private computeFileHash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private validateSketchFormat(sketch: string): {
    valid: boolean;
    error?: string;
    warning?: string;
  } {
    // Markerless sketches are allowed (like Cursor) - treated as full rewrite or LLM's choice
    // Only provide a warning if no markers present
    if (!sketch.includes(ANCHOR_MARKER)) {
      return {
        valid: true,
        warning: `Sketch has no "${ANCHOR_MARKER}" markers. LLM will treat this as a full rewrite or choose appropriate anchors from file.`,
      };
    }

    return { valid: true };
  }

  private async parseLLM(
    fileContent: string,
    editInstructions: string,
    sketch: string,
  ): Promise<ParseResult> {
    try {
      const { fileContext, sketchContext, warnings, error } =
        this.buildLLMContexts(fileContent, sketch);
      if (error) {
        return { success: false, error };
      }

      const prompt = dedent`
        You are the LLM alignment step in a code editor. Your role: propose exact edit operations.
        A deterministic verifier will check and apply your proposals.

        CURRENT FILE (EXCERPT):
        ${fileContext}

        SKETCH (desired final state, "// ... existing code ..." marks unchanged sections):
        ${sketchContext}

        USER INTENT: ${editInstructions}

        YOUR JOB:
        Output edit operations (hunks) where each hunk specifies:
        - beforeAnchor: VERBATIM text from CURRENT FILE (prefer 2-10 lines) before the change
        - afterAnchor: VERBATIM text from CURRENT FILE (prefer 2-10 lines) after the change
        - replacement: exact new code from SKETCH that goes between the anchors (DO NOT include anchors)

        EMPTY ANCHORS (for file boundaries):
        - beforeAnchor can be "" (empty) ONLY for prepending at the beginning of file (BOF)
        - afterAnchor can be "" (empty) ONLY for appending at the end of file (EOF)
        - Both empty ("" and "") means full file rewrite

        CRITICAL:
        1. Anchors MUST be exact copy/paste from CURRENT FILE above
        2. NEVER include new code in anchors (only in replacement)
        3. Anchors should be unique - prefer MULTI-LINE anchors (2+ lines). Single-line anchors are allowed only if they are very distinctive or at file boundaries.
        4. beforeAnchor and afterAnchor MUST be DIFFERENT (never identical) unless one is empty
        5. afterAnchor MUST occur AFTER beforeAnchor in CURRENT FILE (unless empty)
        6. replacement MUST NOT contain beforeAnchor or afterAnchor text
        7. Compare line-by-line: CURRENT vs SKETCH to find differences

        EXAMPLE 1 (middle insert):
        CURRENT: "import A\\nexport class X {}"
        SKETCH: "import A\\n// ... existing code ...\\nimport B\\nexport class X {}"
        Output:
        <json>{"hunks":[{"beforeAnchor":"import A","afterAnchor":"export class X {}","replacement":"import B"}]}</json>

        EXAMPLE 2 (append to end):
        CURRENT: "console.log('hello world');"
        SKETCH: "console.log('hello world');\\n// ... existing code ...\\nfunction greet() { return 'hi'; }"
        Output:
        <json>{"hunks":[{"beforeAnchor":"console.log('hello world');","afterAnchor":"","replacement":"\\nfunction greet() { return 'hi'; }"}]}</json>

        EXAMPLE 3 (prepend to beginning):
        CURRENT: "console.log('hello world');"
        SKETCH: "const os = require('os');\\nconsole.log('hello world');\\n// ... existing code ..."
        Output:
        <json>{"hunks":[{"beforeAnchor":"","afterAnchor":"console.log('hello world');","replacement":"const os = require('os');\\n"}]}</json>

        EXAMPLE 4 (full rewrite):
        CURRENT: "old code"
        SKETCH: "completely new code"
        Output:
        <json>{"hunks":[{"beforeAnchor":"","afterAnchor":"","replacement":"completely new code"}]}</json>

        IMPORTANT: Wrap your JSON output in <json>...</json> tags.
        Output format:
        <json>{"hunks":[{"beforeAnchor":"...","afterAnchor":"...","replacement":"...","occurrence":1}]}</json>
      `;
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
        const { content } = await this.openaiService.response(
          { message },
          {
            model: environment.filesEditModel,
            reasoning: {
              effort: 'minimal',
            },
            text: { verbosity: 'low' },
          },
        );
        return content ?? '';
      };

      const safeContent = await callLLM(prompt);

      // Extract JSON from <json>...</json> sentinel tags
      const jsonTagMatch = safeContent.match(/<json>([\s\S]*?)<\/json>/);
      if (!jsonTagMatch) {
        return {
          success: false,
          error:
            'LLM did not wrap output in <json>...</json> tags. Try files_edit_reapply with a smarter model.',
        };
      }

      const jsonString = jsonTagMatch[1]?.trim();
      if (!jsonString) {
        return {
          success: false,
          error: 'Empty JSON content in <json> tags. Try files_edit_reapply.',
        };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonString);
      } catch (parseError) {
        return {
          success: false,
          error: `Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}. Try files_edit_reapply.`,
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
          error: `Invalid hunk structure: ${issues}. Try files_edit_reapply or files_apply_changes.`,
        };
      }

      const hunks = validation.data.hunks;

      // Retry once if the model violates basic invariants (commonly: identical anchors).
      const invalidReasons: string[] = [];
      for (const h of hunks) {
        if (!h?.beforeAnchor || !h?.afterAnchor) {
          invalidReasons.push('Missing beforeAnchor/afterAnchor');
          continue;
        }
        if (h.beforeAnchor === h.afterAnchor) {
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
        const retryJsonTagMatch = retryContent.match(
          /<json>([\s\S]*?)<\/json>/,
        );
        if (!retryJsonTagMatch || !retryJsonTagMatch[1]?.trim()) {
          return {
            success: false,
            error:
              'LLM retry did not return valid <json> wrapped output. Try files_edit_reapply with a smarter model.',
          };
        }

        let retryParsed: unknown;
        try {
          retryParsed = JSON.parse(retryJsonTagMatch[1].trim());
        } catch {
          return {
            success: false,
            error:
              'LLM retry returned invalid JSON. Try files_edit_reapply with a smarter model.',
          };
        }

        const retryValidation = LLMResponseSchema.safeParse(retryParsed);
        if (!retryValidation.success) {
          return {
            success: false,
            error:
              'LLM retry returned invalid hunk structure. Try files_edit_reapply or files_apply_changes.',
          };
        }

        return {
          success: true,
          hunks: retryValidation.data.hunks,
        };
      }

      return {
        success: true,
        hunks,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: `${error instanceof Error ? error.message : String(error)}. Try files_edit_reapply with a smarter model.`,
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

    // Sketch context: prefer full sketch, but truncate to cap if too large.
    let sketchContext = sketch;
    const sketchBytes = Buffer.byteLength(sketchContext, 'utf8');
    if (sketchBytes > LIMITS.MAX_LLM_SKETCH_CONTEXT_BYTES) {
      const head = sketch.slice(
        0,
        Math.floor(LIMITS.MAX_LLM_SKETCH_CONTEXT_BYTES / 2),
      );
      const tail = sketch.slice(
        Math.max(
          0,
          sketch.length - Math.floor(LIMITS.MAX_LLM_SKETCH_CONTEXT_BYTES / 2),
        ),
      );
      sketchContext = `${head}\n\n/* ... SKETCH TRUNCATED ... */\n\n${tail}`;
      warnings.push('Sketch was truncated for LLM context budget.');
    }

    // For small files, send the entire file content without excerpts (like Cursor)
    const fileBytes = Buffer.byteLength(fileContent, 'utf8');
    if (fileBytes <= LIMITS.MAX_LLM_FILE_CONTEXT_BYTES) {
      return { fileContext: fileContent, sketchContext, warnings };
    }

    // File context: include only relevant slices to avoid blowing context window.
    // Strategy:
    // - Always include head + tail (limited)
    // - Add slices around distinctive lines from sketch that also exist in file
    const fileLines = fileContent.split('\n');

    const candidateLines = sketch
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l.trim().length >= 30 && l.trim() !== ANCHOR_MARKER)
      .slice(0, 40);

    const slices: { startLine: number; endLine: number }[] = [];
    const addSlice = (startLine: number, endLine: number) => {
      const s = Math.max(0, startLine);
      const e = Math.min(fileLines.length, endLine);
      if (s >= e) return;
      slices.push({ startLine: s, endLine: e });
    };

    // Always include head/tail slices
    addSlice(0, Math.min(fileLines.length, 120));
    addSlice(Math.max(0, fileLines.length - 120), fileLines.length);

    // Add up to N matches from candidate lines
    for (const line of candidateLines) {
      const idx = fileLines.findIndex((fl) => fl.includes(line));
      if (idx !== -1) {
        addSlice(idx - 25, idx + 26);
      }
      if (slices.length >= 10) break;
    }

    // Merge overlapping slices
    slices.sort((a, b) => a.startLine - b.startLine);
    const merged: { startLine: number; endLine: number }[] = [];
    for (const s of slices) {
      const last = merged[merged.length - 1];
      if (!last || s.startLine > last.endLine + 1) {
        merged.push({ ...s });
      } else {
        last.endLine = Math.max(last.endLine, s.endLine);
      }
    }

    const chunkTexts: string[] = [];
    for (const m of merged) {
      const chunk = fileLines.slice(m.startLine, m.endLine).join('\n');
      chunkTexts.push(
        `/* FILE CONTEXT LINES ${m.startLine + 1}-${m.endLine} */\n${chunk}`,
      );
    }

    let fileContext = chunkTexts.join('\n\n');
    const fileContextBytes = Buffer.byteLength(fileContext, 'utf8');
    if (fileContextBytes > LIMITS.MAX_LLM_FILE_CONTEXT_BYTES) {
      // Hard truncate from the end to fit budget
      fileContext = fileContext.slice(0, LIMITS.MAX_LLM_FILE_CONTEXT_BYTES);
      warnings.push('File context was truncated for LLM context budget.');
    }

    // If we somehow ended up with too little context, fail deterministically.
    if (fileContext.trim().length === 0) {
      return {
        fileContext: '',
        sketchContext,
        warnings,
        error:
          'Unable to build LLM context. Provide a smaller file or use files_apply_changes.',
      };
    }

    return { fileContext, sketchContext, warnings };
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
  ): { start: number; end: number; matchedText: string }[] {
    const pairs: { start: number; end: number; matchedText: string }[] = [];

    // Case 1: Full rewrite (both anchors empty)
    if (beforeAnchor === '' && afterAnchor === '') {
      return [{ start: 0, end: content.length, matchedText: content }];
    }

    // Case 2: Prepend (beforeAnchor empty, afterAnchor exists) - insert at BOF
    if (beforeAnchor === '') {
      let from = 0;
      while (from <= content.length) {
        const afterIdx = content.indexOf(afterAnchor, from);
        if (afterIdx === -1) break;
        const end = afterIdx + afterAnchor.length;
        pairs.push({ start: 0, end, matchedText: content.slice(0, end) });
        if (pairs.length >= LIMITS.MAX_ANCHOR_PAIRS_PER_HUNK) break;
        from = afterIdx + 1;
      }
      return pairs;
    }

    // Case 3: Append (afterAnchor empty, beforeAnchor exists) - insert at EOF
    if (afterAnchor === '') {
      let from = 0;
      while (from <= content.length) {
        const beforeIdx = content.indexOf(beforeAnchor, from);
        if (beforeIdx === -1) break;
        pairs.push({
          start: beforeIdx,
          end: content.length,
          matchedText: content.slice(beforeIdx),
        });
        if (pairs.length >= LIMITS.MAX_ANCHOR_PAIRS_PER_HUNK) break;
        from = beforeIdx + 1;
      }
      return pairs;
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

  private buildNewTextFromHunk(hunk: ParsedHunk): string | null {
    // newText := beforeAnchor + replacement + afterAnchor
    // replacement should not include anchors verbatim (but don't be overly strict for tiny anchors).
    const shouldGuardAnchorInReplacement = (anchor: string) =>
      anchor.includes('\n') || anchor.length >= 20;
    if (
      (shouldGuardAnchorInReplacement(hunk.beforeAnchor) &&
        hunk.replacement.includes(hunk.beforeAnchor)) ||
      (shouldGuardAnchorInReplacement(hunk.afterAnchor) &&
        hunk.replacement.includes(hunk.afterAnchor))
    ) {
      return null;
    }

    let newText = hunk.beforeAnchor;
    if (
      hunk.replacement.length > 0 &&
      !newText.endsWith('\n') &&
      !hunk.replacement.startsWith('\n')
    ) {
      newText += '\n';
    }
    newText += hunk.replacement;
    if (
      hunk.afterAnchor.length > 0 &&
      !newText.endsWith('\n') &&
      !hunk.afterAnchor.startsWith('\n')
    ) {
      newText += '\n';
    }
    newText += hunk.afterAnchor;
    return newText;
  }

  private resolveHunksToEdits(
    fileContent: string,
    hunks: ParsedHunk[],
  ): {
    edits?: EditOperation[];
    error?: string;
  } {
    const edits: EditOperation[] = [];

    for (const hunk of hunks) {
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
          error: `Could not find anchors in file. beforeAnchor: "${hunk.beforeAnchor.substring(0, 100)}...", afterAnchor: "${hunk.afterAnchor.substring(0, 100)}...". The anchors must be EXACT text from the current file. Try files_edit_reapply with a smarter model or files_apply_changes if you know the exact oldText/newText.`,
        };
      }

      // Validate anchor span: reject pairs with excessive span
      for (const pair of pairs) {
        const span = pair.end - pair.start;
        if (span > LIMITS.MAX_ANCHOR_SPAN_BYTES) {
          return {
            error: `Anchor span too large: ${span} bytes between beforeAnchor and afterAnchor exceeds ${LIMITS.MAX_ANCHOR_SPAN_BYTES} byte limit. Choose closer anchors or use files_apply_changes for large edits.`,
          };
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

      const anchorStrengthError = this.validateAnchorStrength(
        fileContent,
        hunk,
        pair,
      );
      if (anchorStrengthError) {
        return { error: anchorStrengthError };
      }

      const newText = this.buildNewTextFromHunk(hunk);
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

  private validateAnchorStrength(
    fileContent: string,
    hunk: ParsedHunk,
    pair: { start: number; end: number },
  ): string | null {
    // Empty anchors are always allowed for BOF/EOF cases
    if (hunk.beforeAnchor === '' || hunk.afterAnchor === '') {
      return null;
    }

    // For small files (< 20 lines), relax anchor strength requirements
    const fileLines = fileContent.split('\n').length;
    const isSmallFile = fileLines < 20;

    const beforeLines = hunk.beforeAnchor.split('\n').length;
    const afterLines = hunk.afterAnchor.split('\n').length;
    const beforeIsMultiline = beforeLines >= LIMITS.MIN_ANCHOR_LINES;
    const afterIsMultiline = afterLines >= LIMITS.MIN_ANCHOR_LINES;

    const beforeIsStrongSingleLine =
      !beforeIsMultiline &&
      hunk.beforeAnchor.length >= LIMITS.MIN_SINGLELINE_ANCHOR_CHARS;
    const afterIsStrongSingleLine =
      !afterIsMultiline &&
      hunk.afterAnchor.length >= LIMITS.MIN_SINGLELINE_ANCHOR_CHARS;

    // Boundary exceptions: allow single-line anchors at file boundaries (common for top-of-file insert / end-of-file append)
    const beforeIsFileStart = pair.start === 0;
    const afterIsFileEnd = pair.end === fileContent.length;

    // For small files, allow any anchor (don't enforce multi-line or length requirements)
    if (isSmallFile) {
      return null;
    }

    if (!beforeIsMultiline && !beforeIsStrongSingleLine && !beforeIsFileStart) {
      return `Weak beforeAnchor: prefer ${LIMITS.MIN_ANCHOR_LINES}+ lines, or >=${LIMITS.MIN_SINGLELINE_ANCHOR_CHARS} chars, or anchor at file start. Provided anchor looks too generic.`;
    }

    if (!afterIsMultiline && !afterIsStrongSingleLine && !afterIsFileEnd) {
      return `Weak afterAnchor: prefer ${LIMITS.MIN_ANCHOR_LINES}+ lines, or >=${LIMITS.MIN_SINGLELINE_ANCHOR_CHARS} chars, or anchor at file end. Provided anchor looks too generic.`;
    }

    return null;
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

    // Changed lines ratio check (approximate)
    // Skip ratio check for full rewrite (like Cursor) - single edit replacing entire file
    const isFullRewrite =
      edits.length === 1 &&
      edits[0]!.start === 0 &&
      edits[0]!.end === fileContent.length;

    if (!isFullRewrite) {
      const fileLines = fileContent.split('\n').length;
      let changedLines = 0;
      for (const edit of edits) {
        changedLines += edit.oldText.split('\n').length;
        changedLines += edit.newText.split('\n').length;
      }
      const changeRatio = changedLines / (fileLines * 2); // Divide by 2 since we count both old and new

      if (changeRatio > LIMITS.MAX_CHANGED_LINES_RATIO) {
        return {
          ok: false,
          error: `${(changeRatio * 100).toFixed(0)}% change ratio exceeds ${LIMITS.MAX_CHANGED_LINES_RATIO * 100}% limit. Break into smaller changes or use files_write_file for complete rewrites.`,
        };
      }
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
    // Apply edits by captured indices, bottom-to-top. No re-searching.
    const sorted = [...edits].sort((a, b) => b.start - a.start);
    let result = fileContent;

    for (const edit of sorted) {
      const currentSlice = result.slice(edit.start, edit.end);
      if (currentSlice !== edit.oldText) {
        throw new Error(
          `Could not find match for oldText at expected range during apply`,
        );
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
    const modifiedLines = modifiedContent.split('\n');

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
    config: FilesEditToolConfig,
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

    const parseResult = await this.parseLLM(
      fileContent,
      args.editInstructions,
      args.codeSketch,
    );

    if (!parseResult.success || !parseResult.hunks) {
      return {
        output: {
          success: false,
          error:
            parseResult.error ||
            'Failed to parse sketch. Try files_edit_reapply.',
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    const { edits, error } = this.resolveHunksToEdits(
      fileContent,
      parseResult.hunks,
    );
    if (error) {
      return {
        output: {
          success: false,
          error,
          filePath: args.filePath,
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
      },
      messageMetadata,
    };
  }
}
