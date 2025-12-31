import { basename } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { isObject } from 'lodash';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

const MAX_MATCHES = 30;

export const FilesSearchTextToolSchema = z.object({
  dir: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Directory path to search. If omitted, uses the current working directory of the persistent shell session. Use absolute paths when provided.',
    ),
  query: z
    .string()
    .min(1)
    .describe('The text pattern to search for (regex supported by ripgrep).'),
  filePath: z
    .string()
    .optional()
    .describe(
      'Optional absolute file path to search in. If provided, searches only in this specific file. Can be used directly with paths returned from files_find_paths.',
    ),
  includeGlobs: z
    .array(z.string())
    .optional()
    .describe(
      'Optional array of glob patterns to include (e.g., ["*.ts", "src/**"]).',
    ),
  excludeGlobs: z
    .array(z.string())
    .optional()
    .describe(
      'Optional array of glob patterns to exclude (e.g., ["*.test.ts", "node_modules/**"]).',
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

function shQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class FilesSearchTextTool extends FilesBaseTool<FilesSearchTextToolSchemaType> {
  public name = 'files_search_text';
  public description =
    'Search file contents with ripgrep (regex) and return structured matches.';

  protected override generateTitle(
    args: FilesSearchTextToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const location = args.filePath
      ? basename(args.filePath)
      : (args.dir ?? 'current directory');
    return `Searching in ${location}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Searches for text patterns across files using ripgrep (rg), one of the fastest text search tools available. Returns structured JSON results with file paths, line numbers, and matched content. If \`dir\` is omitted, the search runs in the current working directory of the persistent shell session (e.g., after \`shell\` tool cd).

      ### When to Use
      - Finding where a function, class, or variable is defined or used
      - Searching for specific patterns (TODO comments, error messages)
      - Locating configuration values or constants
      - Finding all imports of a module
      - Investigating how a feature is implemented across the codebase

      ### When NOT to Use
      - When you know the exact file → use files_read directly
      - For listing files without searching content → use files_find_paths
      - For symbol-based search (functions, classes) → consider files_search_tags if tags index exists

      ### query examples
      **Literal search:**
      Example: {"dir": "/repo", "query": "getUserById"}

      **Regex search:**
      - Find async functions: {"dir": "/repo", "query": "function\\\\s+\\\\w+Async"}
      - Find React imports: {"dir": "/repo", "query": "import.*from .* react"}
      - Find any of these: {"dir": "/repo", "query": "TODO|FIXME|HACK"}

      **Case sensitivity:**
      - Default is case-sensitive
      - Use (?i) prefix for case-insensitive: "(?i)error"

      ### Best Practices

      **1. Be specific with patterns:**
      - Good: {"dir": "/repo", "query": "handleSubmit"}
      - Good (after shell cd /repo): {"query": "handleSubmit"}
      - Better: {"dir": "/repo", "query": "function handleSubmit|const handleSubmit"}

      **Quick current-directory searches (after shell cd):**
      - {"query": "TODO"}
      - {"query": "useEffect", "includeGlobs": ["*.tsx"]}

      **2. Use file filters to reduce noise:**
      Example: {"dir": "/repo", "query": "useState", "includeGlobs": ["*.tsx"], "excludeGlobs": ["*.test.tsx"]}

      **Default excludes (performance / noise control):**
      By default (when \`excludeGlobs\` is NOT provided), this tool automatically excludes common “junk” directories to make searches faster and results cleaner, such as:
      - VCS/system: \`.git\`
      - Dependencies: \`node_modules\`
      - Build outputs: \`dist\`, \`build\`, \`out\`, \`.output\`, \`.next\`
      - Coverage: \`coverage\`
      - Tool caches: \`.turbo\`, \`.vercel\`, \`.cache\`
      - Temp folders: \`tmp\`, \`temp\`
      - Autogenerated code: \`src/autogenerated\`

      These exclusions are tuned to avoid scanning large, frequently-changing artifacts (build results, caches, generated code) that usually add noise and slow down searches.

      **Repo/language-specific excludes:**
      For best performance on a specific repository or language stack, prefer adding repo-specific “junk” directories to \`excludeGlobs\` (e.g., \`generated/\`, \`vendor/\`, \`target/\`, \`venv/\`, \`.idea/\`, etc.) to avoid searching in build artifacts, generated sources, or tooling outputs.

      **Important:**
      If you provide \`excludeGlobs\`, the tool will use ONLY your exclusions (defaults will not be applied automatically).
      If you still want the default exclusions, include them explicitly in \`excludeGlobs\` along with your repo-specific ones.

      Example (extend defaults + add repo-specific):
      {
        "dir": "/repo",
        "query": "somePattern",
        "excludeGlobs": [
          ".git/**",
          "node_modules/**",
          ".next/**",
          "dist/**",
          "build/**",
          "coverage/**",
          ".turbo/**",
          ".vercel/**",
          ".cache/**",
          "out/**",
          ".output/**",
          "tmp/**",
          "temp/**",
          "src/autogenerated/**",
          "generated/**",
          "vendor/**"
        ]
      }

      **3. Escape special regex characters:**
      If searching for literal special characters, escape them:
      - Search for \${: {"dir": "/repo", "query": "\\\\$\\\\{"}
      - Search for []: {"dir": "/repo", "query": "\\\$begin:math:display$\\\\\\$end:math:display$"}

      **4. Systematic discovery of types/enums and allowed values:**
      When trying to find “possible values for X”, prefer a two-step, pattern-based approach instead of many ad-hoc searches:

      - First, hunt for the type/enum/interface definition:
        - {"dir": "/repo", "query": "(enum|type|interface)\\\\s+NewMessageMode"}
        - This helps find canonical definitions for things like \`NewMessageMode\`.

      - If no explicit type/enum/interface is found, search for string-literal unions in field definitions:
        - {"dir": "/repo", "query": "newMessageMode\\\\?\\\\s*:\\\\s*'[^']+'\\\\s*\\\\|"}
        - Adjust the field name and pattern as needed to discover all allowed string literal values.

      This approach makes “find possible values for X” more systematic and reduces overlapping guesswork across multiple searches.

      ### Output Format
      Returns matches as JSON array with type, path, lines, line_number, and submatches. Results are capped at 30 matches to prevent overwhelming output.

      Empty results (no matches found): {"matches": []}

      ### Common Patterns

      **Find function definitions:**
      {"dir": "/repo", "query": "function processData|const processData.*=.*=>"}

      **Find all usages of an import:**
      {"dir": "/repo", "query": "import.*from.*lodash"}

      **Find console.log statements:**
      {"dir": "/repo", "query": "console\\\\.(log|error|warn)"}

      **Find React hooks usage:**
      {"dir": "/repo", "query": "use(State|Effect|Memo|Callback|Ref)\\\\(", "includeGlobs": ["*.tsx", "*.jsx"]}

      **Find TODO comments:**
      {"dir": "/repo", "query": "//.*TODO|/\\\\*.*TODO"}

      ### After Finding Matches
      1. Note the file paths and line numbers from results
      2. Use files_read with filePaths + startLine/endLine to see surrounding context
      3. Use files_apply_changes to make modifications if needed

      ### Error Handling
      - No matches returns empty matches array (not an error)
      - Invalid regex patterns return an error message
      - Missing directory returns an error
    `;
  }

  public get schema() {
    return z.toJSONSchema(FilesSearchTextToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
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
      cmdParts.push('--', shQuote(args.query), shQuote(args.filePath));
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

      if (args.includeGlobs && args.includeGlobs.length > 0) {
        for (const glob of args.includeGlobs) {
          cmdParts.push('--glob', shQuote(glob));
        }
      }

      if (args.excludeGlobs && args.excludeGlobs.length > 0) {
        for (const glob of args.excludeGlobs) {
          cmdParts.push('--glob', shQuote(`!${glob}`));
        }
      } else {
        for (const glob of defaultExcludes) {
          cmdParts.push('--glob', shQuote(`!${glob}/**`));
        }
      }

      cmdParts.push('--', shQuote(args.query), '.');
    }

    const baseCmd = cmdParts.join(' ');
    const cmd = args.dir ? `cd ${shQuote(args.dir)} && ${baseCmd}` : baseCmd;

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
