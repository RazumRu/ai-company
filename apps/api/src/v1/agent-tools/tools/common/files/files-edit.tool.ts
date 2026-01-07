import { createHash } from 'node:crypto';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { OpenaiService } from '../../../../openai/openai.service';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesApplyChangesTool } from './files-apply-changes.tool';

type EditOperation = {
  oldText: string;
  newText: string;
};
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

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

type ParsedHunk = {
  beforeAnchor: string;
  afterAnchor: string;
  replacement: string;
  occurrence?: number;
};

type ParseResult = {
  success: boolean;
  hunks?: ParsedHunk[];
  warnings?: string[];
  errorCode?: ErrorCode;
  errorDetails?: string;
  suggestedNextAction?: string;
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

type ErrorCode =
  | 'INVALID_PATH'
  | 'NOT_FOUND_ANCHOR'
  | 'AMBIGUOUS_MATCH'
  | 'CONFLICT_FILE_CHANGED'
  | 'LIMIT_EXCEEDED'
  | 'INVALID_SKETCH_FORMAT'
  | 'PARSE_FAILED'
  | 'APPLY_FAILED';

type FilesEditToolOutput = SuccessResponse | ErrorResponse;

const LIMITS = {
  MAX_FILE_BYTES: 1_000_000, // 1MB
  MAX_HUNKS: 20,
  MAX_DIFF_BYTES: 100_000, // 100KB
  MAX_CHANGED_LINES_RATIO: 0.5, // 50% of file
};

const ANCHOR_MARKER = '// ... existing code ...';

function formatError(details: string, suggestedNextAction?: string): string {
  if (suggestedNextAction && suggestedNextAction.trim().length > 0) {
    return `${details}\nNext: ${suggestedNextAction}`;
  }
  return details;
}

export type FilesEditToolConfig = FilesBaseToolConfig & {
  fastModel: string;
};

@Injectable()
export class FilesEditTool extends FilesBaseTool<FilesEditToolSchemaType> {
  public name = 'files_edit';
  public description =
    'Apply sketch-based edits to a file using anchor markers (primary editing tool with smart parsing).';

  constructor(
    private readonly openaiService: OpenaiService,
    private readonly filesApplyChangesTool: FilesApplyChangesTool,
  ) {
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

      ### Sketch Format Requirements

      **CRITICAL: Each hunk must include 3-8 lines of exact context on BOTH sides:**

      \`\`\`typescript
      // Good - clear anchors before and after
      function getUserById(id) {
        const user = database.find(id);
        if (!user) {
          throw new Error('Not found');
        }
      // ... existing code ...
        const updatedUser = transformUser(user);  // NEW LINE INSERTED HERE
      // ... existing code ...
        logger.info('User retrieved');
        return user;
      }

      // Bad - no context (will fail)
      const updatedUser = transformUser(user);

      // Bad - missing afterAnchor context
      function getUserById(id) {
        const user = database.find(id);
      // ... existing code ...
      const updatedUser = transformUser(user);
      \`\`\`

      **Rules:**
      1. Include 3-8 lines of **exact** code before and after each change
      2. No "bare new code" without surrounding anchors
      3. If multiple similar blocks exist, add MORE context or unique identifiers
      4. Use \`// ... existing code ...\` to mark unchanged sections

      ### Error Handling

      On failure, the tool returns an \`error\` string that includes what went wrong and what to try next. If needed, retry with \`files_edit_reapply\` (smarter parsing) or use \`files_apply_changes\` for manual oldText/newText edits.

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

  private parseDeterministicAnchors(
    fileContent: string,
    sketch: string,
  ): ParseResult {
    // Split sketch by anchor markers
    const parts = sketch.split(ANCHOR_MARKER);

    // Must have at least 2 parts (one marker) to be valid
    if (parts.length < 2) {
      return {
        success: false,
        errorCode: 'INVALID_SKETCH_FORMAT',
        errorDetails: `Sketch must contain at least one "${ANCHOR_MARKER}" marker`,
        suggestedNextAction: `Add "${ANCHOR_MARKER}" markers to show what code to keep unchanged`,
      };
    }

    const hunks: ParsedHunk[] = [];

    // Parse hunks from parts
    for (let i = 0; i < parts.length - 1; i++) {
      const before = parts[i] || '';
      const after = parts[i + 1] || '';

      // Extract beforeAnchor (last few lines of 'before' part)
      const beforeLines = before.split('\n');
      const beforeAnchor = beforeLines.slice(-10).join('\n').trim();

      // Extract afterAnchor (first few lines of 'after' part)
      const afterLines = after.split('\n');
      const afterAnchor = afterLines.slice(0, 10).join('\n').trim();

      // Replacement is empty for now (will be filled by LLM if needed)
      const replacement = '';

      // Validate minimum anchor quality
      const totalChars = beforeAnchor.length + afterAnchor.length;
      const beforeLineCount = beforeAnchor.split('\n').length;
      const afterLineCount = afterAnchor.split('\n').length;

      if (!beforeAnchor || !afterAnchor) {
        return {
          success: false,
          errorCode: 'INVALID_SKETCH_FORMAT',
          errorDetails:
            'Anchors cannot be empty - need context before and after each marker',
          suggestedNextAction:
            'Include 3-8 lines of exact code before and after each change',
        };
      }

      if (beforeLineCount + afterLineCount < 2 && totalChars < 40) {
        return {
          success: false,
          needsLLM: true, // Weak anchors, let LLM try to parse
        };
      }

      hunks.push({
        beforeAnchor,
        afterAnchor,
        replacement,
      });
    }

    if (hunks.length === 0) {
      return {
        success: false,
        errorCode: 'INVALID_SKETCH_FORMAT',
        errorDetails: 'No valid hunks could be extracted from sketch',
        suggestedNextAction:
          'Provide clear before/after context around each change',
      };
    }

    return {
      success: true,
      hunks,
    };
  }

  private async parseLLM(
    fileContent: string,
    editInstructions: string,
    sketch: string,
    model: string,
  ): Promise<ParseResult> {
    try {
      const prompt = dedent`
        You are a precise code editor. Extract anchor-based hunks from a code sketch.

        FILE CONTENT:
        \`\`\`
        ${fileContent}
        \`\`\`

        USER INTENT: ${editInstructions}

        CODE SKETCH:
        \`\`\`
        ${sketch}
        \`\`\`

        Extract hunks where each hunk has:
        - beforeAnchor: exact substring immediately before the region to replace
        - afterAnchor: exact substring immediately after the region to replace
        - replacement: new code to insert between anchors

        Return ONLY valid JSON with this structure:
        {
          "hunks": [
            {
              "beforeAnchor": "exact text before",
              "afterAnchor": "exact text after",
              "replacement": "new code to insert"
            }
          ]
        }
      `;

      const { content } = await this.openaiService.generate(prompt, { model });

      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          success: false,
          errorCode: 'PARSE_FAILED',
          errorDetails: 'LLM did not return valid JSON',
          suggestedNextAction: 'Try files_edit_reapply with a smarter model',
        };
      }

      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !('hunks' in parsed) ||
        !Array.isArray((parsed as { hunks: unknown }).hunks) ||
        (parsed as { hunks: unknown[] }).hunks.length === 0
      ) {
        return {
          success: false,
          errorCode: 'PARSE_FAILED',
          errorDetails: 'LLM returned empty or invalid hunks',
          suggestedNextAction: 'Try files_edit_reapply or files_apply_changes',
        };
      }

      return {
        success: true,
        hunks: (parsed as { hunks: ParsedHunk[] }).hunks,
      };
    } catch (error) {
      return {
        success: false,
        errorCode: 'PARSE_FAILED',
        errorDetails: error instanceof Error ? error.message : String(error),
        suggestedNextAction: 'Try files_edit_reapply with a smarter model',
      };
    }
  }

  private normalizeText(text: string): string {
    return text.replace(/\r\n/g, '\n').trim();
  }

  private normalizeNewlines(text: string): string {
    return text.replace(/\r\n/g, '\n');
  }

  private normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private resolveHunksToEdits(
    fileContent: string,
    hunks: ParsedHunk[],
  ): {
    edits?: EditOperation[];
    error?: { code: ErrorCode; details: string; suggestedAction: string };
  } {
    const edits: EditOperation[] = [];
    const fileLines = fileContent.split('\n');

    for (const hunk of hunks) {
      // Try matching tiers
      let match: { start: number; end: number; matchedText: string } | null =
        null;

      // Tier 1: Exact match
      match = this.findMatchInContent(
        fileContent,
        hunk.beforeAnchor,
        hunk.afterAnchor,
        'exact',
      );

      // Tier 2: Normalized newlines
      if (!match) {
        match = this.findMatchInContent(
          this.normalizeNewlines(fileContent),
          this.normalizeNewlines(hunk.beforeAnchor),
          this.normalizeNewlines(hunk.afterAnchor),
          'newline',
        );
      }

      // Tier 3: Whitespace insensitive
      if (!match) {
        match = this.findMatchInContent(
          this.normalizeWhitespace(fileContent),
          this.normalizeWhitespace(hunk.beforeAnchor),
          this.normalizeWhitespace(hunk.afterAnchor),
          'whitespace',
        );
      }

      if (!match) {
        return {
          error: {
            code: 'NOT_FOUND_ANCHOR',
            details: `Could not find anchors in file. beforeAnchor: "${hunk.beforeAnchor.substring(0, 50)}...", afterAnchor: "${hunk.afterAnchor.substring(0, 50)}..."`,
            suggestedAction:
              'Add 5-10 more lines of exact surrounding context from the file',
          },
        };
      }

      if (match.start === -1) {
        return {
          error: {
            code: 'AMBIGUOUS_MATCH',
            details: `Multiple matches found for anchors. Need more unique context.`,
            suggestedAction:
              'Add more unique anchors like function names, comments, or additional lines of context',
          },
        };
      }

      // Convert match to edit
      edits.push({
        oldText: match.matchedText,
        newText: hunk.replacement,
      });
    }

    // Check for overlapping edits
    const editRanges: { start: number; end: number; index: number }[] = [];
    for (let i = 0; i < edits.length; i++) {
      const edit = edits[i];
      if (!edit) continue;

      // Find the range in file for this edit
      const oldTextLines = edit.oldText.split('\n');
      let startLine = -1;
      for (let j = 0; j <= fileLines.length - oldTextLines.length; j++) {
        const candidate = fileLines
          .slice(j, j + oldTextLines.length)
          .join('\n');
        if (candidate === edit.oldText) {
          startLine = j;
          break;
        }
      }

      if (startLine !== -1) {
        editRanges.push({
          start: startLine,
          end: startLine + oldTextLines.length - 1,
          index: i,
        });
      }
    }

    // Sort by start line and check overlaps
    editRanges.sort((a, b) => a.start - b.start);
    for (let i = 0; i < editRanges.length - 1; i++) {
      const current = editRanges[i];
      const next = editRanges[i + 1];
      if (current && next && current.end >= next.start) {
        return {
          error: {
            code: 'APPLY_FAILED',
            details: `Overlapping edits detected: hunks ${current.index} and ${next.index} overlap at lines ${current.start + 1}-${next.end + 1}`,
            suggestedAction:
              'Ensure hunks target non-overlapping regions of the file',
          },
        };
      }
    }

    return { edits };
  }

  private findMatchInContent(
    content: string,
    beforeAnchor: string,
    afterAnchor: string,
    _tier: 'exact' | 'newline' | 'whitespace',
  ): { start: number; end: number; matchedText: string } | null {
    const beforeIndex = content.indexOf(beforeAnchor);
    if (beforeIndex === -1) return null;

    // Look for afterAnchor after beforeAnchor
    const searchStart = beforeIndex + beforeAnchor.length;
    const afterIndex = content.indexOf(afterAnchor, searchStart);
    if (afterIndex === -1) return null;

    // Check if there are multiple matches
    const secondBeforeIndex = content.indexOf(beforeAnchor, beforeIndex + 1);
    if (secondBeforeIndex !== -1 && secondBeforeIndex < afterIndex) {
      // Ambiguous
      return { start: -1, end: -1, matchedText: '' };
    }

    const matchedText = content.substring(
      beforeIndex,
      afterIndex + afterAnchor.length,
    );
    return {
      start: beforeIndex,
      end: afterIndex + afterAnchor.length,
      matchedText,
    };
  }

  private checkLimits(
    fileContent: string,
    edits: EditOperation[],
  ): {
    ok: boolean;
    errorCode?: ErrorCode;
    details?: string;
    suggestedAction?: string;
  } {
    // File size check
    const fileBytes = Buffer.byteLength(fileContent, 'utf8');
    if (fileBytes > LIMITS.MAX_FILE_BYTES) {
      return {
        ok: false,
        errorCode: 'LIMIT_EXCEEDED',
        details: `File size ${(fileBytes / 1_000_000).toFixed(2)}MB exceeds ${LIMITS.MAX_FILE_BYTES / 1_000_000}MB limit`,
        suggestedAction:
          'Use files_apply_changes for large files or split into smaller edits',
      };
    }

    // Hunks count check
    if (edits.length > LIMITS.MAX_HUNKS) {
      return {
        ok: false,
        errorCode: 'LIMIT_EXCEEDED',
        details: `${edits.length} hunks exceeds ${LIMITS.MAX_HUNKS} limit`,
        suggestedAction:
          'Break changes into multiple files_edit calls with fewer hunks each',
      };
    }

    // Changed lines ratio check (approximate)
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
        errorCode: 'LIMIT_EXCEEDED',
        details: `${(changeRatio * 100).toFixed(0)}% change ratio exceeds ${LIMITS.MAX_CHANGED_LINES_RATIO * 100}% limit`,
        suggestedAction:
          'Break into smaller changes or use files_write_file for complete rewrites',
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

  public async invoke(
    args: FilesEditToolSchemaType,
    config: FilesEditToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesEditToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    // 1. Read file and compute baseline
    const p = this.shQuote(args.filePath);
    const readResult = await this.execCommand({ cmd: `cat ${p}` }, config, cfg);

    if (readResult.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: formatError(
            readResult.stderr || 'Failed to read file',
            'Verify the file exists and is readable',
          ),
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    const fileContent = readResult.stdout;
    const baseSha = this.computeFileHash(fileContent);

    // 2. Parse with deterministic anchor parser
    let parseResult = this.parseDeterministicAnchors(
      fileContent,
      args.codeSketch,
    );

    // 3. Escalate to LLM if needed
    if (!parseResult.success) {
      if (parseResult.errorCode === 'INVALID_SKETCH_FORMAT') {
        return {
          output: {
            success: false,
            error: formatError(
              parseResult.errorDetails || 'Invalid sketch format',
              parseResult.suggestedNextAction || 'Fix sketch format',
            ),
            filePath: args.filePath,
          },
          messageMetadata,
        };
      }

      if (parseResult.needsLLM) {
        parseResult = await this.parseLLM(
          fileContent,
          args.editInstructions,
          args.codeSketch,
          config.fastModel,
        );
      }
    }

    if (!parseResult.success || !parseResult.hunks) {
      return {
        output: {
          success: false,
          error: formatError(
            parseResult.errorDetails || 'Failed to parse sketch',
            parseResult.suggestedNextAction || 'Try files_edit_reapply',
          ),
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    // 4. Resolve hunks to edits
    const { edits, error } = this.resolveHunksToEdits(
      fileContent,
      parseResult.hunks,
    );
    if (error) {
      return {
        output: {
          success: false,
          error: formatError(error.details, error.suggestedAction),
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    if (!edits || edits.length === 0) {
      return {
        output: {
          success: false,
          error: formatError(
            'No edits could be resolved from hunks',
            'Check your sketch format and anchors',
          ),
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    // 5. Re-read file and check conflict
    const reReadResult = await this.execCommand(
      { cmd: `cat ${p}` },
      config,
      cfg,
    );
    if (reReadResult.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: formatError(
            'Failed to re-read file for conflict check',
            'Re-read file with files_read and retry',
          ),
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    const currentContent = reReadResult.stdout;
    const currentSha = this.computeFileHash(currentContent);

    if (currentSha !== baseSha) {
      return {
        output: {
          success: false,
          error: formatError(
            'File was modified between read and apply',
            'Re-read file with files_read and retry',
          ),
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    // 6. Check limits
    const limitCheck = this.checkLimits(currentContent, edits);
    if (!limitCheck.ok) {
      return {
        output: {
          success: false,
          error: formatError(
            limitCheck.details || 'Limit exceeded',
            limitCheck.suggestedAction || 'Break into smaller changes',
          ),
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    // 7. Apply edits sequentially using FilesApplyChangesTool
    let appliedCount = 0;
    let allDiffs = '';

    for (const edit of edits) {
      const applyResult = await this.filesApplyChangesTool.invoke(
        {
          filePath: args.filePath,
          oldText: edit.oldText,
          newText: edit.newText,
        },
        config,
        cfg,
      );

      if (!applyResult.output.success) {
        return {
          output: {
            success: false,
            error: formatError(
              applyResult.output.error || 'Failed to apply changes',
              'Try files_apply_changes with manual oldText/newText',
            ),
            filePath: args.filePath,
          },
          messageMetadata,
        };
      }

      appliedCount += applyResult.output.appliedEdits || 0;
      if (applyResult.output.diff) {
        allDiffs += (allDiffs ? '\n' : '') + applyResult.output.diff;
      }
    }

    return {
      output: {
        success: true,
        filePath: args.filePath,
        diff: this.truncateDiff(allDiffs, LIMITS.MAX_DIFF_BYTES),
        appliedHunks: appliedCount,
      },
      messageMetadata,
    };
  }
}
