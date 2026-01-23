import { randomUUID } from 'node:crypto';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { zodToAjvSchema } from '../../../agent-tools.utils';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

export const FilesFindPathsToolSchema = z.object({
  searchInDirectory: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Directory to search in. If not specified, uses current working directory.',
    ),
  filenamePattern: z
    .string()
    .min(1)
    .describe(
      'Glob pattern to match file names/paths. Use "*" to list all files, "*.ts" for TypeScript files, etc.',
    ),
  includeSubdirectories: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      'Search in subdirectories recursively. Set to false to only search the specified directory.',
    ),
  maxDepth: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Maximum directory depth to search (only used when includeSubdirectories is true)',
    ),
  skipPatterns: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Glob patterns to exclude from search (e.g., ["node_modules/**", "dist/**"]). If not specified, common build/cache folders are excluded.',
    ),
  maxResults: z
    .number()
    .int()
    .positive()
    .optional()
    .default(200)
    .describe('Maximum number of file paths to return (default: 200)'),
});

// Use `z.input<>` so callers can omit defaulted fields like `includeSubdirectories`/`maxResults`.
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
    const location = args.searchInDirectory ?? 'current directory';
    return `Finding "${args.filenamePattern}" in ${location}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Find file paths by glob (path/name only). Returns absolute paths.

      ### When to Use
      - Locating files before read/edit
      - Quick directory listing
      - Finding config files by pattern

      ### When NOT to Use
      - Content search -> \`files_search_text\`
      - Structure overview -> \`files_directory_tree\`

      ### Best Practices
      - Use specific patterns and small maxResults to limit output.
      - For listing a folder: includeSubdirectories=false + filenamePattern="*".
      - Use maxDepth to limit traversal.
      - Add skipPatterns if results include build artifacts.

      ### Examples
      **1) List a single directory (non-recursive):**
      \`\`\`json
      {"searchInDirectory":"/repo/src","filenamePattern":"*","includeSubdirectories":false}
      \`\`\`

      **2) Find all TypeScript files (limited):**
      \`\`\`json
      {"searchInDirectory":"/repo","filenamePattern":"**/*.ts","maxResults":100}
      \`\`\`
    `;
  }

  public get schema() {
    return zodToAjvSchema(FilesFindPathsToolSchema);
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
    const includeSubdirectories = args.includeSubdirectories ?? true;

    const skipPatterns =
      args.skipPatterns && args.skipPatterns.length > 0
        ? args.skipPatterns
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
      shQuote(args.filenamePattern),
      '--max-results',
      String(probeLimit),
    ];

    if (!includeSubdirectories) {
      fdCmdParts.push('--max-depth', '1');
    } else if (args.maxDepth !== undefined) {
      fdCmdParts.push('--max-depth', String(args.maxDepth));
    }

    for (const ex of skipPatterns) {
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

    const cmd = args.searchInDirectory
      ? `cd ${shQuote(args.searchInDirectory)} && ${script}`
      : script;

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
        : (args.searchInDirectory ?? '').trim();

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
