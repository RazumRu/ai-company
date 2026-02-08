import { basename } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { isObject } from 'lodash';
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
      'Text or regex pattern to search for in file contents. Supports full regex syntax (e.g., "function\\s+createUser", "import.*from").',
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
      'Only search files matching these glob patterns (e.g., ["*.ts", "src/**"])',
    ),
  skipFilesMatching: z
    .array(z.string())
    .optional()
    .describe(
      'Don\'t search files matching these glob patterns (e.g., ["*.test.ts", "node_modules/**"])',
    ),
});

export type FilesSearchTextToolSchemaType = z.infer<
  typeof FilesSearchTextToolSchema
>;

type FilesSearchTextToolOutput = {
  error?: string;
  matches?: {
    type: string;
    data: {
      path?: {
        text: string;
      };
      lines?: {
        text: string;
      };
      line_number?: number;
      absolute_offset?: number;
      submatches?: {
        match: {
          text: string;
        };
        start: number;
        end: number;
      }[];
    };
  }[];
};

@Injectable()
export class FilesSearchTextTool extends FilesBaseTool<FilesSearchTextToolSchemaType> {
  public name = 'files_search_text';
  public description =
    'Search file contents using a regex pattern and return matching file paths, line numbers, and matched text. Returns up to 15 matches. Best used after codebase_search for exact pattern matching (function names, variable references, import paths). Supports include/exclude glob filters via onlyInFilesMatching and skipFilesMatching. Common build/cache directories (node_modules, dist, .next, etc.) are excluded by default.';

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
      Search file contents using regex (ripgrep). Returns matching file paths, line numbers, and matched text. Returns up to ${MAX_MATCHES} matches. Use after \`codebase_search\` for exact, literal pattern matching (function names, variable references, import paths).

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
      Uses ripgrep regex (Rust flavor, similar to PCRE):
      - \`\\s+\` — whitespace, \`\\w+\` — word chars, \`\\b\` — word boundary
      - \`.\` — any char, \`.*\` — greedy match, \`.*?\` — lazy match
      - \`(a|b)\` — alternation, \`[A-Z]\` — character class
      - Escape special chars: \`\\.\`, \`\\(\`, \`\\[\`, \`\\{\`

      ### Best Practices
      - Use \`codebase_search\` first for discovery, then this tool for exact matches
      - Prefer one regex with alternation over multiple calls: \`(foo|bar|baz)\` instead of 3 separate searches
      - Use \`onlyInFilesMatching\` to limit scope (e.g., \`["*.ts"]\` for TypeScript only)
      - Use \`skipFilesMatching\` to exclude test files: \`["*.test.ts", "*.spec.ts"]\`
      - Common build/cache folders (node_modules, dist, .next, etc.) are excluded by default

      ### Output Format
      Returns up to ${MAX_MATCHES} matches, each with:
      - \`path.text\` — absolute file path
      - \`lines.text\` — the matched line content
      - \`line_number\` — 1-based line number
      - \`submatches[].match.text\` — the exact matched substring

      ### Examples
      **1. Find type/interface definitions:**
      \`\`\`json
      {"searchInDirectory":"/repo","textPattern":"(enum|type|interface)\\\\s+UserRole","onlyInFilesMatching":["*.ts"]}
      \`\`\`

      **2. Find all imports of a module:**
      \`\`\`json
      {"searchInDirectory":"/repo/src","textPattern":"from\\\\s+['\\\"]@packages/common['\\\"]"}
      \`\`\`

      **3. Search in a single file:**
      \`\`\`json
      {"filePath":"/repo/src/auth/auth.service.ts","textPattern":"async\\\\s+validate"}
      \`\`\`

      **4. Find TODO/FIXME comments excluding tests:**
      \`\`\`json
      {"searchInDirectory":"/repo/src","textPattern":"(TODO|FIXME|HACK)","skipFilesMatching":["*.test.ts","*.spec.ts"]}
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

      const defaultExcludes = [
        '.git',
        'node_modules',
        '.next',
        'dist',
        'build',
        'coverage',
        '.turbo',
        '.vercel',
        '.cache',
        'out',
        '.output',
        'tmp',
        'temp',
        'src/autogenerated',
      ];

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
        for (const glob of defaultExcludes) {
          cmdParts.push('--glob', shQuote(`!${glob}/**`));
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

      return {
        output: {
          error: res.stderr || res.stdout || 'Failed to search text',
        },
        messageMetadata,
      };
    }

    const lines = res.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0);
    const matches: FilesSearchTextToolOutput['matches'] = [];
    type Match = NonNullable<FilesSearchTextToolOutput['matches']>[number];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as unknown;
        const parsedType = isObject(parsed)
          ? (parsed as { type?: unknown }).type
          : undefined;

        if (parsedType === 'match') {
          if (matches.length >= MAX_MATCHES) {
            break;
          }
          matches.push(parsed as Match);
        }
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
