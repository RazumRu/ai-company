import { basename } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { shQuote } from '../../../../utils/shell.utils';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

const MAX_MATCHES = 15;

export const FilesSearchTextToolSchema = z.object({
  searchInDirectory: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Directory to search in. If not specified, searches in current working directory.',
    ),
  textPattern: z
    .string()
    .min(1)
    .describe(
      'The regex pattern to search for in file contents. Supports full regex syntax ' +
        '(e.g., "log.*Error", "function\\s+\\w+", "import.*from"). ' +
        'For literal text with special chars, escape them: "run\\(" instead of "run(", ' +
        '"array\\[0\\]" instead of "array[0]".',
    ),
  filePath: z
    .string()
    .optional()
    .describe(
      'Search only in this specific file. Can use paths from files_find_paths output.',
    ),
  onlyInFilesMatching: z
    .array(z.string())
    .optional()
    .describe(
      'Only search files matching these glob patterns (e.g., ["*.ts", "src/**"]). ' +
        'If omitted, searches all non-excluded file types.',
    ),
  skipFilesMatching: z
    .array(z.string())
    .optional()
    .describe(
      'Exclude files matching these glob patterns (e.g., ["*.test.ts", "*.spec.ts"]). ' +
        'If omitted, common build/cache directories (node_modules, dist, .next, etc.) are excluded by default.',
    ),
});

export type FilesSearchTextToolSchemaType = z.infer<
  typeof FilesSearchTextToolSchema
>;

type FilesSearchTextToolOutput = {
  error?: string;
  matches?: {
    filePath: string;
    lineNumber: number;
    lineText: string;
    matchedText: string;
  }[];
};

@Injectable()
export class FilesSearchTextTool extends FilesBaseTool<FilesSearchTextToolSchemaType> {
  public name = 'files_search_text';
  public description =
    'Search file contents using a regex pattern and return matching file paths, line numbers, and matched text. ' +
    'Returns up to 15 matches. Supports full regex syntax (e.g., "function\\s+\\w+", "import.*from"). ' +
    'Best used after codebase_search for exact pattern matching. ' +
    'Supports include/exclude glob filters via onlyInFilesMatching and skipFilesMatching. ' +
    'Common build/cache directories (node_modules, dist, .next, etc.) are excluded by default.';

  protected override generateTitle(
    args: FilesSearchTextToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const location = args.filePath
      ? basename(args.filePath)
      : (args.searchInDirectory ?? 'current directory');
    return `Searching for "${args.textPattern}" in ${location}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Search file contents using a regex pattern. Returns matching file paths, line numbers, and matched text. Returns up to ${MAX_MATCHES} matches.
      Supports full regex syntax for flexible pattern matching.

      ### When to Use
      - Finding exact usages of a function, variable, class, or import
      - Locating specific error messages or string literals in code
      - Searching for patterns across many files (e.g., all TODO comments)
      - Verifying that a rename or refactor caught all references

      ### When NOT to Use
      - Initial codebase discovery → use \`codebase_search\` first (semantic search is better for "where is X?")
      - Reading file contents → use \`files_read\`
      - Finding files by name → use \`files_find_paths\`

      ### Regex Syntax
      - \`\\s+\` — whitespace, \`\\w+\` — word chars, \`\\b\` — word boundary
      - \`.\` — any char, \`.*\` — greedy match, \`.*?\` — lazy match
      - \`(a|b)\` — alternation, \`[A-Z]\` — character class
      - **Escape special chars** for literal matching: \`\\.\`, \`\\(\`, \`\\[\`, \`\\{\`

      ### Best Practices
      - Use \`codebase_search\` first for discovery, then this tool for exact matches
      - Escape regex special characters when searching for literal text containing \`( ) [ ] { } . * + ? | ^ $\`
      - Use \`onlyInFilesMatching\` to limit scope (e.g., \`["*.ts"]\` for TypeScript only)
      - Use \`skipFilesMatching\` to exclude test files: \`["*.test.ts", "*.spec.ts"]\`
      - Common build/cache folders (node_modules, dist, .next, etc.) are excluded by default

      ### Output Format
      Returns up to ${MAX_MATCHES} matches, each with:
      - \`filePath\` — absolute file path
      - \`lineText\` — the matched line content
      - \`lineNumber\` — 1-based line number
      - \`matchedText\` — the exact matched substring

      ### Examples
      **1. Find function calls (escape the parenthesis):**
      \`\`\`json
      {"searchInDirectory":"/repo","textPattern":"run\\\\(","onlyInFilesMatching":["*.ts"]}
      \`\`\`

      **2. Find exact import statement:**
      \`\`\`json
      {"searchInDirectory":"/repo/src","textPattern":"from '@packages/common'"}
      \`\`\`

      **3. Find type/interface definitions:**
      \`\`\`json
      {"searchInDirectory":"/repo","textPattern":"(enum|type|interface)\\\\s+UserRole","onlyInFilesMatching":["*.ts"]}
      \`\`\`

      **4. Find TODO/FIXME comments:**
      \`\`\`json
      {"searchInDirectory":"/repo/src","textPattern":"(TODO|FIXME|HACK)","skipFilesMatching":["*.test.ts","*.spec.ts"]}
      \`\`\`

      **5. Search in a single file:**
      \`\`\`json
      {"filePath":"/repo/src/auth/auth.service.ts","textPattern":"async validate"}
      \`\`\`
    `;
  }

  public get schema() {
    return FilesSearchTextToolSchema;
  }

  public async invoke(
    args: FilesSearchTextToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesSearchTextToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };
    const cmdParts: string[] = ['rg', '--json'];

    if (args.filePath) {
      cmdParts.push('--', shQuote(args.textPattern), shQuote(args.filePath));
    } else {
      cmdParts.push('--hidden');
      cmdParts.push('--glob', shQuote('!.git/**'));

      if (args.onlyInFilesMatching && args.onlyInFilesMatching.length > 0) {
        for (const glob of args.onlyInFilesMatching) {
          cmdParts.push('--glob', shQuote(glob));
        }
      }

      if (args.skipFilesMatching && args.skipFilesMatching.length > 0) {
        for (const glob of args.skipFilesMatching) {
          cmdParts.push('--glob', shQuote(`!${glob}`));
        }
      } else {
        for (const pattern of this.defaultSkipPatterns) {
          cmdParts.push('--glob', shQuote(`!${pattern}`));
        }
      }

      cmdParts.push('--', shQuote(args.textPattern), '.');
    }

    const baseCmd = cmdParts.join(' ');
    const cmd = args.searchInDirectory
      ? `cd ${shQuote(args.searchInDirectory)} && ${baseCmd}`
      : baseCmd;

    const res = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      if (res.exitCode === 1 && !res.stderr) {
        return {
          output: {
            matches: [],
          },
          messageMetadata,
        };
      }

      const errorText = res.stderr || res.stdout || 'Failed to search text';

      // Detect regex syntax errors and provide a helpful hint
      if (errorText.includes('regex parse error')) {
        const hint =
          'HINT: Your regex pattern has a syntax error. ' +
          'Escape special characters for literal matching: use "run\\(" instead of "run(", ' +
          '"array\\[0\\]" instead of "array[0]".';

        return {
          output: {
            error: `${errorText}\n\n${hint}`,
          },
          messageMetadata,
        };
      }

      return {
        output: {
          error: errorText,
        },
        messageMetadata,
      };
    }

    const lines = res.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0);
    const matches: NonNullable<FilesSearchTextToolOutput['matches']> = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        if (typeof parsed !== 'object' || parsed === null) continue;
        const record = parsed as Record<string, unknown>;
        if (record.type !== 'match') continue;
        if (matches.length >= MAX_MATCHES) break;

        const data = record.data as Record<string, unknown> | undefined;
        if (!data) continue;

        const pathObj = data.path as { text?: string } | undefined;
        const linesObj = data.lines as { text?: string } | undefined;
        const submatches = data.submatches as
          | { match?: { text?: string } }[]
          | undefined;

        matches.push({
          filePath: pathObj?.text ?? '',
          lineNumber: (data.line_number as number) ?? 0,
          lineText: linesObj?.text?.replace(/\n$/, '') ?? '',
          matchedText: submatches?.[0]?.match?.text ?? '',
        });
      } catch {
        continue;
      }
    }

    return {
      output: {
        matches,
      },
      messageMetadata,
    };
  }
}
