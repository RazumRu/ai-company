import { randomUUID } from 'node:crypto';

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

export const FilesFindPathsToolSchema = z.object({
  dir: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Directory to search in. If omitted, uses the current working directory of the persistent shell session.',
    ),
  pattern: z
    .string()
    .min(1)
    .describe(
      'Glob pattern (fd --glob) to match file paths. Use "*" to list all files.',
    ),
  recursive: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Whether to search recursively. If false, only lists direct children of dir.',
    ),
  maxDepth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional max depth (applied only when recursive=true).'),
  excludePatterns: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional glob patterns to exclude (fd syntax). If omitted, common junk folders are excluded.',
    ),
  maxResults: z
    .number()
    .int()
    .positive()
    .optional()
    .default(200)
    .describe('Maximum number of paths to return. Default: 200.'),
});

// Use `z.input<>` so callers can omit defaulted fields like `recursive`/`maxResults`.
export type FilesFindPathsToolSchemaType = z.input<
  typeof FilesFindPathsToolSchema
>;

export type FilesFindPathsToolOutput = {
  error?: string;
  files: string[];
  cwd: string;
  returned: number;
  truncated: boolean;
  nextCursor: string | null;
};

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class FilesFindPathsTool extends FilesBaseTool<FilesFindPathsToolSchemaType> {
  public name = 'files_find_paths';
  public description =
    'Find file paths by glob and return absolute paths (no content search).';

  protected override generateTitle(
    args: FilesFindPathsToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const location = args.dir ?? 'current directory';
    return `Finding paths in ${location}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Finds file paths by glob using \`fd\` and returns **absolute paths**. This tool searches by **path/name only** (it does not search file contents).

      ### When to Use
      - Discover files by glob before reading/editing (feed results into \`files_read\` / \`files_apply_changes\`)
      - List “only this directory” by setting \`recursive: false\`
      - Quickly locate config files (e.g. \`**/tsconfig*.json\`, \`**/*.env*\`, \`package.json\`)

      ### When NOT to Use
      - Searching inside files → use \`files_search_text\`
      - Getting a visual structure overview → use \`files_directory_tree\`

      ### Best Practices
      - Prefer \`recursive: false\` + \`pattern: "*"\` to get a quick directory listing without walking the whole tree.
      - Keep patterns specific (e.g. \`**/*.ts\` instead of \`*\`) to avoid huge result sets.
      - If results include junk, add \`excludePatterns\` (defaults exclude common folders like \`node_modules/**\`, \`dist/**\`, etc.).
      - If you only want the first N results, lower \`maxResults\` to reduce output.

      ### Examples
      **1) Find TypeScript files (recursive):**
      \`\`\`json
      {"dir":"/repo","pattern":"**/*.ts"}
      \`\`\`

      **2) List only this directory (non-recursive):**
      \`\`\`json
      {"dir":"/repo","pattern":"*","recursive":false}
      \`\`\`

      **3) Find tsconfig variants and ignore build output:**
      \`\`\`json
      {"dir":"/repo","pattern":"**/tsconfig*.json","excludePatterns":["node_modules/**","dist/**","build/**"]}
      \`\`\`

      ### Output Format
      \`\`\`json
      {
        "files": ["/abs/path/a.ts","/abs/path/b.ts"],
        "cwd": "/abs/path",
        "returned": 2,
        "truncated": false,
        "nextCursor": null
      }
      \`\`\`

      Notes:
      - \`truncated: true\` means more matches existed than \`maxResults\`.
    `;
  }

  public get schema() {
    return z.toJSONSchema(FilesFindPathsToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public async invoke(
    args: FilesFindPathsToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesFindPathsToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const maxResults = args.maxResults ?? 200;
    const probeLimit = maxResults + 1;
    const recursive = args.recursive ?? true;

    const excludePatterns =
      args.excludePatterns && args.excludePatterns.length > 0
        ? args.excludePatterns
        : [
            'node_modules/**',
            'dist/**',
            'build/**',
            'coverage/**',
            '.turbo/**',
            '.next/**',
            '.cache/**',
            'out/**',
            '.output/**',
            'tmp/**',
            'temp/**',
          ];

    const fdCmdParts: string[] = [
      'fd',
      '--absolute-path',
      '--type',
      'f',
      '--hidden',
      '--exclude',
      '.git',
      '--glob',
      shQuote(args.pattern),
      '--max-results',
      String(probeLimit),
    ];

    if (!recursive) {
      fdCmdParts.push('--max-depth', '1');
    } else if (args.maxDepth !== undefined) {
      fdCmdParts.push('--max-depth', String(args.maxDepth));
    }

    for (const ex of excludePatterns) {
      fdCmdParts.push('--exclude', shQuote(ex));
    }

    const fdCmd = fdCmdParts.join(' ');

    const marker = randomUUID();
    const cwdMarker = `__AI_FILES_FIND_PATHS_CWD_${marker}__`;
    const filesMarker = `__AI_FILES_FIND_PATHS_FILES_${marker}__`;
    const exitMarker = `__AI_FILES_FIND_PATHS_EXIT_${marker}__`;

    const script = [
      'set +e',
      `printf "%s\\n" ${shQuote(cwdMarker)}`,
      'pwd',
      `printf "%s\\n" ${shQuote(filesMarker)}`,
      fdCmd,
      '__ec=$?',
      `printf "%s:%s\\n" ${shQuote(exitMarker)} "$__ec"`,
      'exit "$__ec"',
    ].join('; ');

    const cmd = args.dir ? `cd ${shQuote(args.dir)} && ${script}` : script;

    const res = await this.execCommand({ cmd }, config, cfg);

    const stdoutLines = res.stdout.split('\n');
    const cwdIdx = stdoutLines.indexOf(cwdMarker);
    const filesIdx = stdoutLines.indexOf(filesMarker);
    const exitIdx = stdoutLines.findIndex((l) =>
      l.startsWith(`${exitMarker}:`),
    );

    const cwd =
      cwdIdx !== -1 && cwdIdx + 1 < stdoutLines.length
        ? (stdoutLines[cwdIdx + 1] ?? '').trim()
        : (args.dir ?? '').trim();

    const rawFiles =
      filesIdx !== -1 && exitIdx !== -1 && exitIdx > filesIdx
        ? stdoutLines
            .slice(filesIdx + 1, exitIdx)
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
        : [];

    const truncated = rawFiles.length > maxResults;
    const files = truncated ? rawFiles.slice(0, maxResults) : rawFiles;

    if (res.exitCode !== 0) {
      return {
        output: {
          error: res.stderr || res.stdout || 'Failed to find paths',
          files: [],
          cwd,
          returned: 0,
          truncated: false,
          nextCursor: null,
        },
        messageMetadata,
      };
    }

    return {
      output: {
        files,
        cwd,
        returned: files.length,
        truncated,
        nextCursor: null,
      },
      messageMetadata,
    };
  }
}
