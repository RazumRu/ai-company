import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { basename, dirname } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

export const FilesApplyChangesToolEditSchema = z.object({
  oldText: z
    .string()
    .describe(
      'Text block to search for. Matching uses whitespace-normalized exact block match. Empty string means create/overwrite file (only allowed when it is the single edit).',
    ),
  newText: z
    .string()
    .describe('Text to replace with. Indentation will be preserved.'),
});

const FilesApplyChangesToolSchemaBase = z.object({
  path: z.string().min(1).describe('Absolute path to the file to edit'),
  edits: z
    .array(FilesApplyChangesToolEditSchema)
    .min(1)
    .describe('List of edit operations to perform'),
  dryRun: z
    .boolean()
    .default(false)
    .describe('Preview changes without applying them'),
});

export const FilesApplyChangesToolSchema = FilesApplyChangesToolSchemaBase;

export type FilesApplyChangesToolSchemaType = z.input<
  typeof FilesApplyChangesToolSchema
>;
export type FilesApplyChangesToolEditSchemaType = z.input<
  typeof FilesApplyChangesToolEditSchema
>;

type EditMatch = {
  editIndex: number;
  startLine: number;
  endLine: number;
  matchedText: string;
  indentation: string;
};

type FilesApplyChangesToolOutput = {
  error?: string;
  success?: boolean;
  diff?: string;
  appliedEdits?: number;
  totalEdits?: number;
};

@Injectable()
export class FilesApplyChangesTool extends FilesBaseTool<FilesApplyChangesToolSchemaType> {
  public name = 'files_apply_changes';
  public description =
    'Apply targeted text edits to a file (pattern-based; oldText/newText; supports dryRun preview).';

  protected override generateTitle(
    args: FilesApplyChangesToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const name = basename(args.path);
    const editsCount = args.edits.length;
    const dryRunText = args.dryRun ? ' (preview)' : '';
    return `Editing ${name} (${editsCount} edit${editsCount > 1 ? 's' : ''})${dryRunText}`;
  }

  public get schema() {
    return z.toJSONSchema(FilesApplyChangesToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Applies targeted text edits by replacing \`oldText\` with \`newText\`. Supports \`dryRun\` to preview diff without modifying.

      ### How matching works
      Whitespace-normalized exact block match: trailing whitespace and common leading indentation are stripped, but relative indentation within blocks is preserved. Each \`oldText\` must match exactly once: 0 matches = adjust text; >1 match = add more context. Indentation auto-detected and preserved from the matched file location.

      ### When to Use
      Precise changes without overwriting whole file, insert/replace blocks, safe preview with \`dryRun: true\`.

      ### When NOT to Use
      For full overwrite → use \`files_write_file\`. For file deletion → use \`files_delete\`.

      ### CRITICAL: Preventing Common Errors

      **Error: "Found N matches for oldText"**
      - CAUSE: Your \`oldText\` appears multiple times in the file
      - FIX: Add MORE surrounding context (5-10 lines before/after the change)
      - EXAMPLE: If editing line 38 in providers array, include lines 34-42 to distinguish from exports array

      **Error: "Could not find match for oldText"**
      - CAUSE: Your \`oldText\` doesn't exactly match file content (even with whitespace normalization)
      - FIX: Use \`files_read\` FIRST to copy the EXACT text, then modify only what needs to change
      - NEVER guess or type code from memory - always copy from file first

      ### Best Practices
      1. **ALWAYS** use \`files_read\` first to get exact text
      2. **ALWAYS** include 5-10 lines of context around your change
      3. For edits in arrays/lists (providers, imports, exports), include the unique element before/after
      4. Run \`dryRun: true\` first to verify match
      5. If error occurs, read file again and include MORE context
      6. Multiple edits must not overlap (same line in multiple edits), but adjacent edits are allowed

      ### Workflow
      1. \`files_read\` to copy exact block (REQUIRED)
      2. \`files_apply_changes\` with \`dryRun: true\` to verify
      3. \`files_apply_changes\` with \`dryRun: false\` to apply

      ### Examples
      **1. BAD - Not enough context (will fail if pattern repeats):**
      \`\`\`json
      {"path":"/repo/module.ts","edits":[{"oldText":"    GhBranchTool,\\n    GhPushTool,","newText":"    GhBranchTool,\\n    GhPushTool,\\n    GhCreatePRTool,"}]}
      \`\`\`

      **2. GOOD - Sufficient context (unique match):**
      \`\`\`json
      {
        "path": "/repo/module.ts",
        "edits": [{
          "oldText": "    CommunicationToolGroup,\\n    GhCloneTool,\\n    GhCommitTool,\\n    GhBranchTool,\\n    GhPushTool,\\n    GhToolGroup,\\n    FilesFindPathsTool,",
          "newText": "    CommunicationToolGroup,\\n    GhCloneTool,\\n    GhCommitTool,\\n    GhBranchTool,\\n    GhPushTool,\\n    GhCreatePRTool,\\n    GhToolGroup,\\n    FilesFindPathsTool,"
        }]
      }
      \`\`\`

      **3. Multiple edits in one file:**
      \`\`\`json
      {"path":"/repo/config.ts","edits":[{"oldText":"export const VERSION = 1;\\nexport const NAME = 'app';","newText":"export const VERSION = 2;\\nexport const NAME = 'app';"},{"oldText":"export const DEBUG = false;\\nexport const LOG_LEVEL = 'info';","newText":"export const DEBUG = true;\\nexport const LOG_LEVEL = 'info';"}]}
      \`\`\`
    `;
  }

  private shQuote(s: string): string {
    return `'${s.replace(/'/g, `'\\''`)}'`;
  }

  private normalizeWhitespace(text: string): string {
    // Normalize line endings
    const normalized = text.replace(/\r\n/g, '\n');

    // Remove trailing whitespace from each line, but preserve leading spaces
    const lines = normalized
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/g, ''));

    // Strip common indentation to preserve relative indentation
    return this.stripCommonIndent(lines.join('\n')).trim();
  }

  private detectIndentationFromBlock(text: string): string {
    const line = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .find((l) => l.trim().length > 0);
    if (!line) return '';
    const match = line.match(/^(\s+)/);
    return match && match[1] ? match[1] : '';
  }

  private stripCommonIndent(text: string): string {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    if (nonEmpty.length === 0) return lines.join('\n');
    const indents = nonEmpty.map((l) => l?.match(/^(\s*)/)?.[1]?.length ?? 0);
    const minIndent = Math.min(...indents);
    if (minIndent === 0) return lines.join('\n');
    return lines
      .map((l) => (l.trim().length ? l.slice(minIndent) : l))
      .join('\n');
  }

  private applyIndentation(text: string, indentation: string): string {
    const stripped = this.stripCommonIndent(text).replace(/\r\n/g, '\n');
    if (!indentation) return stripped;
    const lines = stripped.split('\n');
    return lines
      .map((line) => {
        // Apply indentation to all non-empty lines
        return line.trim() === '' ? line : indentation + line;
      })
      .join('\n');
  }

  private findMatches(
    fileContent: string,
    edits: FilesApplyChangesToolEditSchemaType[],
  ): { matches: EditMatch[]; errors: string[] } {
    const lines = fileContent.replace(/\r\n/g, '\n').split('\n');
    const matches: EditMatch[] = [];
    const errors: string[] = [];

    for (let editIndex = 0; editIndex < edits.length; editIndex++) {
      const edit = edits[editIndex];

      if (!edit) {
        continue;
      }

      if (edit.oldText === '') {
        continue;
      }

      const normalizedOldText = this.normalizeWhitespace(edit.oldText);
      const searchLines = normalizedOldText.split('\n');
      const searchLineCount = searchLines.length;

      const foundMatches: EditMatch[] = [];

      for (
        let lineIndex = 0;
        lineIndex <= lines.length - searchLineCount;
        lineIndex++
      ) {
        const candidateLines = lines.slice(
          lineIndex,
          lineIndex + searchLineCount,
        );
        const normalizedCandidate = this.normalizeWhitespace(
          candidateLines.join('\n'),
        );

        if (normalizedCandidate === normalizedOldText) {
          const candidateBlock = candidateLines.join('\n');
          const indentation = this.detectIndentationFromBlock(candidateBlock);
          foundMatches.push({
            editIndex,
            startLine: lineIndex,
            endLine: lineIndex + searchLineCount - 1,
            matchedText: candidateBlock,
            indentation,
          });
        }
      }

      if (foundMatches.length === 0) {
        const previewLines = normalizedOldText.split('\n').slice(0, 3);
        const preview =
          previewLines.length < searchLines.length
            ? `${previewLines.join('\\n')}...`
            : normalizedOldText;
        errors.push(
          `Edit ${editIndex}: Could not find match for oldText in file. Searched for (normalized): "${preview}". TIP: Use files_read to copy the EXACT text from the file, then modify only what needs to change. Don't guess or type from memory.`,
        );
      } else if (foundMatches.length > 1) {
        const matchLocations = foundMatches
          .map((m) => `lines ${m.startLine + 1}-${m.endLine + 1}`)
          .join(', ');
        errors.push(
          `Edit ${editIndex}: Found ${foundMatches.length} matches for oldText at ${matchLocations}. TIP: Add MORE surrounding context (5-10 lines before/after) to make the match unique. Include nearby unique elements like function names, imports, or comments.`,
        );
      } else if (foundMatches[0]) {
        matches.push(foundMatches[0]);
      }
    }

    return { matches, errors };
  }

  private generateDiff(
    originalLines: string[],
    matches: EditMatch[],
    edits: FilesApplyChangesToolEditSchemaType[],
  ): string {
    const diffParts: string[] = [];

    for (const match of matches) {
      const edit = edits[match.editIndex];
      if (!edit || edit.newText === undefined) continue;

      const contextBefore = 2;
      const contextAfter = 2;

      const startContext = Math.max(0, match.startLine - contextBefore);
      const endContext = Math.min(
        originalLines.length - 1,
        match.endLine + contextAfter,
      );

      const newTextLines = (edit?.newText ?? '').split('\n').length;
      diffParts.push(
        `@@ -${match.startLine + 1},${match.endLine - match.startLine + 1} +${match.startLine + 1},${newTextLines} @@`,
      );

      for (let i = startContext; i < match.startLine; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffParts.push(` ${line}`);
        }
      }

      for (let i = match.startLine; i <= match.endLine; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffParts.push(`-${line}`);
        }
      }

      if (edit) {
        const newTextWithIndent = this.applyIndentation(
          edit.newText,
          match.indentation,
        );
        for (const line of newTextWithIndent.split('\n')) {
          diffParts.push(`+${line}`);
        }
      }

      for (let i = match.endLine + 1; i <= endContext; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffParts.push(` ${line}`);
        }
      }
    }

    return diffParts.join('\n');
  }

  private applyEdits(
    fileContent: string,
    matches: EditMatch[],
    edits: FilesApplyChangesToolEditSchemaType[],
  ): string {
    const lines = fileContent.replace(/\r\n/g, '\n').split('\n');

    const sortedMatches = [...matches].sort(
      (a, b) => b.startLine - a.startLine,
    );

    for (const match of sortedMatches) {
      const edit = edits[match.editIndex];
      if (!edit || edit.newText === undefined) continue;

      const newTextWithIndent = this.applyIndentation(
        edit.newText,
        match.indentation,
      );
      const newLines = newTextWithIndent.split('\n');

      lines.splice(
        match.startLine,
        match.endLine - match.startLine + 1,
        ...newLines,
      );
    }

    return lines.join('\n');
  }

  public async invoke(
    args: FilesApplyChangesToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesApplyChangesToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const isNewFile = args.edits.every((edit) => edit.oldText === '');
    const hasAnyEmptyOldText = args.edits.some((edit) => edit.oldText === '');

    if (hasAnyEmptyOldText && !(isNewFile && args.edits.length === 1)) {
      return {
        output: {
          success: false,
          error:
            'Invalid edits: oldText="" is only allowed when it is the single edit to create/overwrite a file.',
        },
        messageMetadata,
      };
    }

    if (isNewFile && args.edits.length === 1) {
      const firstEdit = args.edits[0];
      if (!firstEdit) {
        return {
          output: {
            success: false,
            error: 'No edits provided',
          },
          messageMetadata,
        };
      }
      const newContent = firstEdit.newText;

      if (args.dryRun) {
        const diffLines = newContent
          .split('\n')
          .map((line) => `+${line}`)
          .join('\n');
        return {
          output: {
            success: true,
            appliedEdits: 0,
            totalEdits: 1,
            diff: `New file:\n${diffLines}`,
          },
          messageMetadata,
        };
      }

      const parentDir = dirname(args.path);
      const contentBase64 = Buffer.from(newContent, 'utf8').toString('base64');
      const tempFile = `${args.path}.tmp.${Date.now()}.${randomBytes(4).toString('hex')}`;

      const cmd = `mkdir -p ${this.shQuote(parentDir)} && printf %s ${this.shQuote(contentBase64)} | base64 -d > ${this.shQuote(tempFile)} && mv ${this.shQuote(tempFile)} ${this.shQuote(args.path)}`;

      const writeResult = await this.execCommand(
        {
          cmd,
        },
        config,
        cfg,
      );

      if (writeResult.exitCode !== 0) {
        return {
          output: {
            success: false,
            error: writeResult.stderr || 'Failed to create file',
          },
          messageMetadata,
        };
      }

      return {
        output: {
          success: true,
          appliedEdits: 1,
          totalEdits: 1,
        },
        messageMetadata,
      };
    }

    const p = this.shQuote(args.path);
    const readResult = await this.execCommand({ cmd: `cat ${p}` }, config, cfg);

    if (readResult.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: readResult.stderr || 'Failed to read file',
        },
        messageMetadata,
      };
    }

    const fileContent = readResult.stdout;

    const { matches, errors } = this.findMatches(fileContent, args.edits);

    if (errors.length > 0) {
      return {
        output: {
          success: false,
          error: errors.join(' '),
        },
        messageMetadata,
      };
    }

    // Validate no overlapping edits
    const sortedMatches = [...matches].sort(
      (a, b) => a.startLine - b.startLine,
    );
    for (let i = 0; i < sortedMatches.length - 1; i++) {
      const current = sortedMatches[i];
      const next = sortedMatches[i + 1];
      if (current && next && current.endLine >= next.startLine) {
        return {
          output: {
            success: false,
            error: `Overlapping edits detected: Edit ${current.editIndex} (lines ${current.startLine + 1}-${current.endLine + 1}) overlaps with Edit ${next.editIndex} (lines ${next.startLine + 1}-${next.endLine + 1}). Edits must target non-overlapping ranges.`,
          },
          messageMetadata,
        };
      }
    }

    const originalLines = fileContent.replace(/\r\n/g, '\n').split('\n');
    const diff = this.generateDiff(originalLines, matches, args.edits);

    if (args.dryRun) {
      return {
        output: {
          success: true,
          appliedEdits: 0,
          totalEdits: args.edits.length,
          diff,
        },
        messageMetadata,
      };
    }

    const modifiedContent = this.applyEdits(fileContent, matches, args.edits);

    const contentBase64 = Buffer.from(modifiedContent, 'utf8').toString(
      'base64',
    );
    const tempFile = `${args.path}.tmp.${Date.now()}.${randomBytes(4).toString('hex')}`;
    const cmd = `printf %s ${this.shQuote(contentBase64)} | base64 -d > ${this.shQuote(tempFile)} && mv ${this.shQuote(tempFile)} ${this.shQuote(args.path)}`;

    const writeResult = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (writeResult.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: writeResult.stderr || 'Failed to write file',
        },
        messageMetadata,
      };
    }

    return {
      output: {
        success: true,
        appliedEdits: matches.length,
        totalEdits: args.edits.length,
        diff,
      },
      messageMetadata,
    };
  }
}
