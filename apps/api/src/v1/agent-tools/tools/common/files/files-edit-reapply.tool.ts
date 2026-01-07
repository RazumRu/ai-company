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
import {
  FilesApplyChangesTool,
  FilesApplyChangesToolEditSchemaType,
} from './files-apply-changes.tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

const FilesEditReapplyToolSchema = z.object({
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

export type FilesEditReapplyToolSchemaType = z.input<
  typeof FilesEditReapplyToolSchema
>;

type ParsedHunk = {
  beforeAnchor: string;
  afterAnchor: string;
  replacement: string;
  occurrence?: number;
};

type ParseResult = {
  success: boolean;
  hunks?: ParsedHunk[];
  errorCode?: ErrorCode;
  errorDetails?: string;
  suggestedNextAction?: string;
};

type SuccessResponse = {
  success: true;
  filePath: string;
  diff: string;
  appliedHunks: number;
};

type ErrorResponse = {
  success: false;
  errorCode: ErrorCode;
  errorDetails: string;
  suggestedNextAction: string;
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

type FilesEditReapplyToolOutput = SuccessResponse | ErrorResponse;

const LIMITS = {
  MAX_FILE_BYTES: 1_000_000, // 1MB
  MAX_HUNKS: 20,
  MAX_DIFF_BYTES: 100_000, // 100KB
  MAX_CHANGED_LINES_RATIO: 0.5, // 50% of file
};

export type FilesEditReapplyToolConfig = FilesBaseToolConfig & {
  smartModel?: string; // Default: 'gpt-5.1' - Used for smart LLM parsing
};

@Injectable()
export class FilesEditReapplyTool extends FilesBaseTool<FilesEditReapplyToolSchemaType> {
  public name = 'files_edit_reapply';
  public description =
    'Reapply file edit using a more capable model with enhanced prompting (use after files_edit fails).';

  constructor(
    private readonly openaiService: OpenaiService,
    private readonly filesApplyChangesTool: FilesApplyChangesTool,
  ) {
    super();
  }

  protected override generateTitle(
    args: FilesEditReapplyToolSchemaType,
    _config: FilesEditReapplyToolConfig,
  ): string {
    const fileName = args.filePath.split('/').pop() || args.filePath;
    return `Re-editing ${fileName} (smart model)`;
  }

  public get schema() {
    return z.toJSONSchema(FilesEditReapplyToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public getDetailedInstructions(
    _config: FilesEditReapplyToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Reapply file edit using a more capable model. Use this tool when \`files_edit\` fails with PARSE_FAILED or APPLY_FAILED.

      ### When to Use
      - After \`files_edit\` returns PARSE_FAILED error
      - After \`files_edit\` returns APPLY_FAILED error
      - When you need smarter parsing for complex code structures

      ### When NOT to Use
      - As the primary editing tool (use \`files_edit\` first)
      - For simple edits (stick with \`files_edit\`)
      - When error is INVALID_PATH, NOT_FOUND_ANCHOR, AMBIGUOUS_MATCH (fix the sketch instead)

      ### Parameters
      Same as \`files_edit\`:
      - \`filePath\`: Absolute path to file
      - \`editInstructions\`: Description of changes
      - \`codeSketch\`: Sketch with \`// ... existing code ...\` markers

      ### Difference from files_edit
      - Uses smarter, more capable model (gpt-5.1 by default)
      - Enhanced prompting for better anchor extraction
      - Skips fast deterministic parser
      - May be slower and more expensive

      ### Example Usage

      After receiving PARSE_FAILED from files_edit:

      \`\`\`json
      {
        "filePath": "/workspace/src/complex-file.ts",
        "editInstructions": "Add validation logic",
        "codeSketch": "function validateUser(user) {\\n  // existing checks\\n// ... existing code ...\\n  if (!user.email) throw new Error('Email required');\\n// ... existing code ...\\n  return true;\\n}"
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

  private async parseLLMSmart(
    fileContent: string,
    editInstructions: string,
    sketch: string,
    model: string,
  ): Promise<ParseResult> {
    try {
      const prompt = dedent`
        You are a precise code editor with enhanced parsing capabilities.
        Extract anchor-based hunks from a code sketch with MAXIMUM PRECISION.
        
        FILE CONTENT:
        \`\`\`
        ${fileContent}
        \`\`\`
        
        USER INTENT: ${editInstructions}
        
        CODE SKETCH:
        \`\`\`
        ${sketch}
        \`\`\`
        
        CRITICAL REQUIREMENTS:
        1. Extract hunks with UNIQUE, UNAMBIGUOUS anchors
        2. Include 5-10 lines of context in each anchor
        3. Use CASE-SENSITIVE exact matches only
        4. Avoid common patterns that could match multiple locations
        5. Include unique identifiers like function names, comments, or variable names
        
        Each hunk must have:
        - beforeAnchor: exact substring immediately before the region to replace (5-10 lines of unique context)
        - afterAnchor: exact substring immediately after the region to replace (5-10 lines of unique context)
        - replacement: new code to insert between anchors
        
        Return ONLY valid JSON with this structure:
        {
          "hunks": [
            {
              "beforeAnchor": "exact unique text before (5-10 lines)",
              "afterAnchor": "exact unique text after (5-10 lines)",
              "replacement": "new code to insert"
            }
          ]
        }
        
        Ensure anchors are UNIQUE and will only match ONE location in the file.
      `;

      const { content } = await this.openaiService.generate(prompt, { model });

      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          success: false,
          errorCode: 'PARSE_FAILED',
          errorDetails: 'Smart model did not return valid JSON',
          suggestedNextAction:
            'Try files_apply_changes with manual oldText/newText',
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
          errorDetails: 'Smart model returned empty or invalid hunks',
          suggestedNextAction:
            'Try files_apply_changes with manual oldText/newText',
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
        suggestedNextAction:
          'Try files_apply_changes with manual oldText/newText',
      };
    }
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
    edits?: FilesApplyChangesToolEditSchemaType[];
    error?: { code: ErrorCode; details: string; suggestedAction: string };
  } {
    const edits: FilesApplyChangesToolEditSchemaType[] = [];
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
              'Use files_apply_changes with exact oldText/newText from files_read',
          },
        };
      }

      if (match.start === -1) {
        return {
          error: {
            code: 'AMBIGUOUS_MATCH',
            details: `Multiple matches found for anchors even with smart model`,
            suggestedAction:
              'Use files_apply_changes with exact oldText/newText from files_read',
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
    edits: FilesApplyChangesToolEditSchemaType[],
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
          'Break changes into multiple files_edit_reapply calls with fewer hunks each',
      };
    }

    // Changed lines ratio check (approximate)
    const fileLines = fileContent.split('\n').length;
    let changedLines = 0;
    for (const edit of edits) {
      changedLines += edit.oldText.split('\n').length;
      changedLines += edit.newText.split('\n').length;
    }
    const changeRatio = changedLines / (fileLines * 2);

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
    args: FilesEditReapplyToolSchemaType,
    config: FilesEditReapplyToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesEditReapplyToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    // 1. Read file and compute baseline
    const p = this.shQuote(args.filePath);
    const readResult = await this.execCommand({ cmd: `cat ${p}` }, config, cfg);

    if (readResult.exitCode !== 0) {
      return {
        output: {
          success: false,
          errorCode: 'INVALID_PATH',
          errorDetails: readResult.stderr || 'Failed to read file',
          suggestedNextAction: 'Verify the file exists and is readable',
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    const fileContent = readResult.stdout;
    const baseSha = this.computeFileHash(fileContent);

    // 2. Parse with smart LLM (skip deterministic parser)
    const smartModel = config.smartModel || 'gpt-5.1';
    const parseResult = await this.parseLLMSmart(
      fileContent,
      args.editInstructions,
      args.codeSketch,
      smartModel,
    );

    if (!parseResult.success || !parseResult.hunks) {
      return {
        output: {
          success: false,
          errorCode: parseResult.errorCode || 'PARSE_FAILED',
          errorDetails:
            parseResult.errorDetails ||
            'Failed to parse sketch with smart model',
          suggestedNextAction:
            parseResult.suggestedNextAction || 'Try files_apply_changes',
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    // 3. Resolve hunks to edits
    const { edits, error } = this.resolveHunksToEdits(
      fileContent,
      parseResult.hunks,
    );
    if (error) {
      return {
        output: {
          success: false,
          errorCode: error.code,
          errorDetails: error.details,
          suggestedNextAction: error.suggestedAction,
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    if (!edits || edits.length === 0) {
      return {
        output: {
          success: false,
          errorCode: 'APPLY_FAILED',
          errorDetails: 'No edits could be resolved from hunks',
          suggestedNextAction:
            'Check your sketch format and try files_apply_changes',
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    // 4. Re-read file and check conflict
    const reReadResult = await this.execCommand(
      { cmd: `cat ${p}` },
      config,
      cfg,
    );
    if (reReadResult.exitCode !== 0) {
      return {
        output: {
          success: false,
          errorCode: 'CONFLICT_FILE_CHANGED',
          errorDetails: 'Failed to re-read file for conflict check',
          suggestedNextAction: 'Re-read file with files_read and retry',
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
          errorCode: 'CONFLICT_FILE_CHANGED',
          errorDetails: 'File was modified between read and apply',
          suggestedNextAction: 'Re-read file with files_read and retry',
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    // 5. Check limits
    const limitCheck = this.checkLimits(currentContent, edits);
    if (!limitCheck.ok) {
      return {
        output: {
          success: false,
          errorCode: limitCheck.errorCode || 'LIMIT_EXCEEDED',
          errorDetails: limitCheck.details || 'Limit exceeded',
          suggestedNextAction:
            limitCheck.suggestedAction || 'Break into smaller changes',
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    // 6. Apply using FilesApplyChangesTool logic
    const applyResult = await this.filesApplyChangesTool.invoke(
      {
        filePath: args.filePath,
        edits,
        dryRun: false,
      },
      config,
      cfg,
    );

    if (!applyResult.output.success) {
      return {
        output: {
          success: false,
          errorCode: 'APPLY_FAILED',
          errorDetails: applyResult.output.error || 'Failed to apply changes',
          suggestedNextAction:
            'Try files_apply_changes with manual oldText/newText',
          filePath: args.filePath,
        },
        messageMetadata,
      };
    }

    return {
      output: {
        success: true,
        filePath: args.filePath,
        diff: this.truncateDiff(
          applyResult.output.diff || '',
          LIMITS.MAX_DIFF_BYTES,
        ),
        appliedHunks: applyResult.output.appliedEdits || 0,
      },
      messageMetadata,
    };
  }
}
