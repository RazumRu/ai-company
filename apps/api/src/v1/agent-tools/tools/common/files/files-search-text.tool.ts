import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { ExtendedLangGraphRunnableConfig } from '../../base-tool';
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
      'Optional absolute file path to search in. If provided, searches only in this specific file. Can be used directly with paths returned from files_list.',
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

@Injectable()
export class FilesSearchTextTool extends FilesBaseTool<FilesSearchTextToolSchemaType> {
  public name = 'files_search_text';
  public description =
    'Search for text patterns in repository files using ripgrep (rg). Supports regex patterns, file filtering with globs, and searching in specific files. The filePath parameter expects an absolute path (can be used directly with paths returned from files_list). Returns JSON-formatted search results with file paths, line numbers, and matched text (capped at 30 matches).';

  public getDetailedInstructions(
    config: FilesBaseToolConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

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
      - For listing files without searching content → use files_list
      - For symbol-based search (functions, classes) → consider files_search_tags if tags index exists

      ${parameterDocs}

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

      **3. Escape special regex characters:**
      If searching for literal special characters, escape them:
      - Search for \${: {"dir": "/repo", "query": "\\\\$\\\\{"}
      - Search for []: {"dir": "/repo", "query": "\\\\[\\\\]"}

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
      2. Use files_read with startLine/endLine to see surrounding context
      3. Use files_apply_changes to make modifications if needed

      ### Error Handling
      - No matches returns empty matches array (not an error)
      - Invalid regex patterns return an error message
      - Missing directory returns an error
    `;
  }

  public get schema() {
    return FilesSearchTextToolSchema;
  }

  public async invoke(
    args: FilesSearchTextToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<FilesSearchTextToolOutput> {
    const cmdParts: string[] = ['rg', '--json'];

    // If filePath is provided, use absolute path directly (no need to cd)
    if (args.filePath) {
      cmdParts.push(`"${args.query}"`, `"${args.filePath}"`);
    } else {
      // Add hidden flag when searching across files
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

      // Add include globs
      if (args.includeGlobs && args.includeGlobs.length > 0) {
        for (const glob of args.includeGlobs) {
          cmdParts.push('--glob', `'${glob}'`);
        }
      }

      if (args.excludeGlobs && args.excludeGlobs.length > 0) {
        for (const glob of args.excludeGlobs) {
          cmdParts.push('--glob', `'!${glob}'`);
        }
      } else {
        // Default: exclude common heavy directories
        for (const glob of defaultExcludes) {
          cmdParts.push('--glob', `'!${glob}/**'`);
        }
      }

      // Add query
      cmdParts.push(`"${args.query}"`);
    }

    const baseCmd = cmdParts.join(' ');
    const cmd = args.dir ? `cd "${args.dir}" && ${baseCmd}` : baseCmd;

    const res = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      // ripgrep returns exit code 1 when no matches are found, which is not an error
      if (res.exitCode === 1 && !res.stderr) {
        return {
          matches: [],
        };
      }

      return {
        error: res.stderr || res.stdout || 'Failed to search text',
      };
    }

    // Parse JSON lines output from ripgrep
    const lines = res.stdout
      .split('\n')
      .filter((line) => line.trim().length > 0);
    const matches: FilesSearchTextToolOutput['matches'] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'match') {
          if (matches.length >= MAX_MATCHES) {
            break;
          }
          matches.push(parsed);
        }
      } catch (e) {
        // Skip invalid JSON lines (like summary lines)
        continue;
      }
    }

    return {
      matches,
    };
  }
}
