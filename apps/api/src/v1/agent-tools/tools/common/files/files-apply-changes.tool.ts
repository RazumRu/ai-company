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

const FilesApplyChangesToolSchemaBase = z.object({
  filePath: z.string().min(1).describe('Absolute path to the file to edit'),
  oldText: z
    .string()
    .describe(
      'Text block to search for. Matching uses whitespace-normalized exact block match. Empty string means create/overwrite file.',
    ),
  newText: z
    .string()
    .describe('Text to replace with. Indentation will be preserved.'),
  replaceAll: z
    .boolean()
    .optional()
    .describe(
      'If true, replaces all occurrences of oldText. If false or undefined, requires exactly one match.',
    ),
});

export const FilesApplyChangesToolSchema = FilesApplyChangesToolSchemaBase;

export type FilesApplyChangesToolSchemaType = z.input<
  typeof FilesApplyChangesToolSchema
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
    'Apply targeted text edits to a file (pattern-based; oldText/newText).';

  protected override generateTitle(
    args: FilesApplyChangesToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const name = basename(args.filePath);
    return `Editing ${name}`;
  }

  public get schema() {
    return FilesApplyChangesToolSchema;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Replace exact text blocks (oldText -> newText). Use for precise edits or when \`files_edit\` fails.

      ### Required
      - Run \`files_read\` first and copy exact oldText from the file.
      - Matching uses whitespace-normalized block comparison.

      ### How Matching Works
      - OldText must match exactly once unless \`replaceAll: true\`.
      - Common indentation is normalized; relative indentation is preserved.

      ### When to Use
      - Precise single edits
      - Renames with \`replaceAll: true\`
      - Simple find/replace in one file

      ### When NOT to Use
      - First attempt on multi-line edits -> use \`files_edit\`
      - New file -> \`files_write_file\`

      ### Common Errors and Fixes
      - "Found N matches": add more context or set \`replaceAll: true\`.
      - "Could not find match": re-read the file and copy exact text.

      ### Examples
      **1) Replace all occurrences:**
      \`\`\`json
      {"filePath":"/repo/config.ts","oldText":"oldFunctionName","newText":"newFunctionName","replaceAll":true}
      \`\`\`

      **2) Unique block with context:**
      \`\`\`json
      {"filePath":"/repo/module.ts","oldText":"  providers: [\\n    AService,\\n    BService,\\n  ],","newText":"  providers: [\\n    AService,\\n    BService,\\n    CService,\\n  ],"}
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
    oldText: string,
    replaceAll: boolean,
  ): { matches: EditMatch[]; errors: string[] } {
    const lines = fileContent.replace(/\r\n/g, '\n').split('\n');
    const matches: EditMatch[] = [];
    const errors: string[] = [];

    if (oldText === '') {
      return { matches, errors };
    }

    const normalizedOldText = this.normalizeWhitespace(oldText);
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
          editIndex: 0,
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
        `Could not find match for oldText in file. Searched for (normalized): "${preview}". TIP: Use files_read to copy the EXACT text from the file, then modify only what needs to change. Don't guess or type from memory.`,
      );
    } else if (foundMatches.length > 1 && !replaceAll) {
      const matchLocations = foundMatches
        .map((m) => `lines ${m.startLine + 1}-${m.endLine + 1}`)
        .join(', ');
      errors.push(
        `Found ${foundMatches.length} matches for oldText at ${matchLocations}. TIP: Set replaceAll to true to replace all occurrences, or add MORE surrounding context (5-10 lines before/after) to make the match unique. Include nearby unique elements like function names, imports, or comments.`,
      );
    } else {
      matches.push(...foundMatches);
    }

    return { matches, errors };
  }

  private generateDiff(
    originalLines: string[],
    matches: EditMatch[],
    newText: string,
  ): string {
    const diffParts: string[] = [];

    for (const match of matches) {
      const contextBefore = 2;
      const contextAfter = 2;

      const startContext = Math.max(0, match.startLine - contextBefore);
      const endContext = Math.min(
        originalLines.length - 1,
        match.endLine + contextAfter,
      );

      const newTextLines = newText.split('\n').length;
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

      const newTextWithIndent = this.applyIndentation(
        newText,
        match.indentation,
      );
      for (const line of newTextWithIndent.split('\n')) {
        diffParts.push(`+${line}`);
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
    newText: string,
  ): string {
    const lines = fileContent.replace(/\r\n/g, '\n').split('\n');

    const sortedMatches = [...matches].sort(
      (a, b) => b.startLine - a.startLine,
    );

    for (const match of sortedMatches) {
      const newTextWithIndent = this.applyIndentation(
        newText,
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

    const isNewFile = args.oldText === '';

    if (isNewFile) {
      const newContent = args.newText;

      const parentDir = dirname(args.filePath);
      const contentBase64 = Buffer.from(newContent, 'utf8').toString('base64');
      const tempFile = `${args.filePath}.tmp.${Date.now()}.${randomBytes(4).toString('hex')}`;

      const cmd = `mkdir -p ${this.shQuote(parentDir)} && printf %s ${this.shQuote(contentBase64)} | base64 -d > ${this.shQuote(tempFile)} && mv ${this.shQuote(tempFile)} ${this.shQuote(args.filePath)}`;

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

    const p = this.shQuote(args.filePath);
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

    const { matches, errors } = this.findMatches(
      fileContent,
      args.oldText,
      args.replaceAll ?? false,
    );

    if (errors.length > 0) {
      return {
        output: {
          success: false,
          error: errors.join(' '),
        },
        messageMetadata,
      };
    }

    const originalLines = fileContent.replace(/\r\n/g, '\n').split('\n');
    const diff = this.generateDiff(originalLines, matches, args.newText);

    const modifiedContent = this.applyEdits(fileContent, matches, args.newText);

    const contentBase64 = Buffer.from(modifiedContent, 'utf8').toString(
      'base64',
    );
    const tempFile = `${args.filePath}.tmp.${Date.now()}.${randomBytes(4).toString('hex')}`;
    const cmd = `printf %s ${this.shQuote(contentBase64)} | base64 -d > ${this.shQuote(tempFile)} && mv ${this.shQuote(tempFile)} ${this.shQuote(args.filePath)}`;

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
        totalEdits: 1,
        diff,
      },
      messageMetadata,
    };
  }
}
