import { Buffer } from 'node:buffer';
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
    .min(1)
    .describe(
      'Text to search for (can be substring). Whitespace is normalized for matching.',
    ),
  newText: z
    .string()
    .describe(
      'Text to replace with. Indentation will be preserved from original.',
    ),
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

// Use `z.input<>` so callers can omit defaulted fields like `dryRun`.
// (Defaults are still applied at runtime via Ajv useDefaults + JSON schema "default".)
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
      Exact-match replacement with normalized whitespace (trimmed lines). Each \`oldText\` must match exactly once: 0 matches = adjust text; >1 match = add more context. Indentation auto-detected and preserved.

      ### When to Use
      Precise changes without overwriting whole file, insert/replace blocks, safe preview with \`dryRun: true\`.

      ### When NOT to Use
      For full overwrite → use \`files_write_file\`. For file deletion → use \`files_delete\`.

      ### Best Practices
      Run \`dryRun\` first for important files. Make \`oldText\` unique with 3-15 lines of context. Copy exact blocks via \`files_read\`. If "Found N matches", add nearby lines (imports, function signature) to make unique. For multiple edits in one file, supply multiple edits array.

      ### Workflow
      1. \`files_search_text\` or \`files_read\` to find/copy exact block
      2. \`files_apply_changes\` with \`dryRun: true\` to verify
      3. \`files_apply_changes\` with \`dryRun: false\` to apply

      ### Examples
      **1. Preview single edit (dry run):**
      \`\`\`json
      {"path":"/repo/src/a.ts","edits":[{"oldText":"const x = 1;","newText":"const x = 2;"}],"dryRun":true}
      \`\`\`

      **2. Multi-line edit with context (best practice):**
      \`\`\`json
      {
        "path": "/repo/src/utils.ts",
        "edits": [{
          "oldText": "export function add(a: number, b: number) {\\n  return a + b;\\n}",
          "newText": "export function add(a: number, b: number): number {\\n  return a + b;\\n}"
        }]
      }
      \`\`\`

      **3. Multiple edits in one file:**
      \`\`\`json
      {"path":"/repo/config.ts","edits":[{"oldText":"version: 1","newText":"version: 2"},{"oldText":"debug: false","newText":"debug: true"}]}
      \`\`\`
    `;
  }

  private normalizeWhitespace(text: string): string {
    return text
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim();
  }

  private detectIndentation(line: string): string {
    const match = line.match(/^(\s+)/);
    return match && match[1] ? match[1] : '';
  }

  private applyIndentation(text: string, indentation: string): string {
    if (!indentation) return text;
    return text
      .split('\n')
      .map((line, index) => {
        // Don't indent empty lines or first line if original wasn't indented
        if (line.trim() === '' || (index === 0 && !text.startsWith('\n'))) {
          return line;
        }
        return indentation + line;
      })
      .join('\n');
  }

  private findMatches(
    fileContent: string,
    edits: FilesApplyChangesToolEditSchemaType[],
  ): { matches: EditMatch[]; errors: string[] } {
    const lines = fileContent.split('\n');
    const matches: EditMatch[] = [];
    const errors: string[] = [];

    for (let editIndex = 0; editIndex < edits.length; editIndex++) {
      const edit = edits[editIndex];

      if (!edit) {
        continue;
      }

      // Special case: empty oldText means we're creating/replacing entire file
      if (edit.oldText === '') {
        continue;
      }

      const normalizedOldText = this.normalizeWhitespace(edit.oldText);
      const searchLines = normalizedOldText.split('\n');
      const searchLineCount = searchLines.length;

      const foundMatches: EditMatch[] = [];

      // Search through file for matches
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
          const lineAtIndex = lines[lineIndex];
          const indentation = lineAtIndex
            ? this.detectIndentation(lineAtIndex)
            : '';
          foundMatches.push({
            editIndex,
            startLine: lineIndex,
            endLine: lineIndex + searchLineCount - 1,
            matchedText: candidateLines.join('\n'),
            indentation,
          });
        }
      }

      if (foundMatches.length === 0) {
        errors.push(
          `Edit ${editIndex}: Could not find match for oldText in file.`,
        );
      } else if (foundMatches.length > 1) {
        errors.push(
          `Edit ${editIndex}: Found ${foundMatches.length} matches for oldText. Please be more specific to match uniquely.`,
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

      // Context before
      for (let i = startContext; i < match.startLine; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffParts.push(` ${line}`);
        }
      }

      // Old lines
      for (let i = match.startLine; i <= match.endLine; i++) {
        const line = originalLines[i];
        if (line !== undefined) {
          diffParts.push(`-${line}`);
        }
      }

      // New lines
      if (edit) {
        const newTextWithIndent = this.applyIndentation(
          edit.newText,
          match.indentation,
        );
        for (const line of newTextWithIndent.split('\n')) {
          diffParts.push(`+${line}`);
        }
      }

      // Context after
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
    const lines = fileContent.split('\n');

    // Sort matches by startLine in descending order to apply from bottom to top
    // This prevents line number shifts from affecting subsequent edits
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

      // Replace lines from startLine to endLine with new lines
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

    // Special case: if all edits have empty oldText, we're creating a new file
    const isNewFile = args.edits.every((edit) => edit.oldText === '');

    if (isNewFile && args.edits.length === 1) {
      // Creating new file
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
        return {
          output: {
            success: true,
            appliedEdits: 0,
            totalEdits: 1,
            diff: `New file:\n+${newContent.split('\n').join('\n+')}`,
          },
          messageMetadata,
        };
      }

      // Use base64 encoding to safely handle special characters
      const parentDir = dirname(args.path);
      const contentBase64 = Buffer.from(newContent, 'utf8').toString('base64');
      const tempFile = `${args.path}.tmp.${Date.now()}`;
      const cmd = `mkdir -p "${parentDir}" && echo '${contentBase64}' | base64 -d > "${tempFile}" && mv "${tempFile}" "${args.path}"`;

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

    // Read the file
    const readResult = await this.execCommand(
      { cmd: `cat "${args.path}"` },
      config,
      cfg,
    );

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

    // Find all matches
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

    // Generate diff
    const originalLines = fileContent.split('\n');
    const diff = this.generateDiff(originalLines, matches, args.edits);

    // If dry run, return diff without applying
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

    // Apply edits
    const modifiedContent = this.applyEdits(fileContent, matches, args.edits);

    // Write modified content back to file using base64 encoding
    const contentBase64 = Buffer.from(modifiedContent, 'utf8').toString(
      'base64',
    );
    const tempFile = `${args.path}.tmp.${Date.now()}`;
    const cmd = `echo '${contentBase64}' | base64 -d > "${tempFile}" && mv "${tempFile}" "${args.path}"`;

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
      },
      messageMetadata,
    };
  }
}
