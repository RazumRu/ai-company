import { randomUUID } from 'node:crypto';

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

export const FilesFindPathsToolSchema = z.object({
  searchInDirectory: z
    .string()
    .min(1)
    .nullable()
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
    .nullable()
    .optional()
    .describe(
      'Search in subdirectories recursively. Set to false to only search the specified directory.',
    ),
  maxDepth: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      'Maximum directory depth to search (only used when includeSubdirectories is true)',
    ),
  skipPatterns: z
    .array(z.string().min(1))
    .nullable()
    .optional()
    .describe(
      'Glob patterns to exclude from search (e.g., ["node_modules/**", "dist/**"]). If not specified, common build/cache folders are excluded.',
    ),
  maxResults: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
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
};

@Injectable()
export class FilesFindPathsTool extends FilesBaseTool<FilesFindPathsToolSchemaType> {
  public name = 'files_find_paths';
  public description =
    'Find file paths matching a glob pattern and return their absolute paths without reading file content. Prefer codebase_search for code discovery — it finds relevant code by meaning and returns paths with line numbers. Use this tool when you need to list files by name/extension pattern (e.g., "*.config.ts", "*migration*"), or as a fallback when codebase_search indexing is in progress. Returns up to maxResults paths (default 200). Common build/cache directories (node_modules, dist, .next, etc.) are excluded by default. Set includeSubdirectories=false to search only the specified directory without recursion.';

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
      Find file paths by glob pattern. Returns absolute paths without reading file content. Use this to discover project structure, locate files by extension or name, and list directory contents. Returns up to \`maxResults\` paths (default 200).

      ### Prefer codebase_search First
      Prefer \`codebase_search\` for code discovery — it finds relevant code semantically and returns absolute file paths, line ranges, and code snippets. This tool is for listing files by name/extension pattern when you need to browse the filesystem, or as a fallback when \`codebase_search\` indexing is in progress.

      ### When to Use
      - Locating files by extension: \`"*.ts"\`, \`"*.json"\`, \`"*.yaml"\`
      - Finding files by name pattern: \`"*controller*"\`, \`"*migration*"\`
      - Listing a directory's contents (set \`includeSubdirectories=false\`)
      - Checking if a file exists before reading or editing
      - As a fallback when \`codebase_search\` indexing is in progress

      ### When NOT to Use
      - ❌ Finding where specific code is implemented when \`codebase_search\` is available → prefer \`codebase_search\`
      - ❌ Resolving or verifying paths already returned by \`codebase_search\` (they are already absolute)
      - Searching file contents → use \`files_search_text\` or \`codebase_search\`
      - Reading file content → use \`files_read\`
      - Viewing directory tree → use \`files_directory_tree\` (visual tree format)

      ### Glob Pattern Syntax
      - \`*\` — matches any characters within a filename (not path separators)
      - \`*.ts\` — all TypeScript files
      - \`*controller*\` — files with "controller" anywhere in the name
      - \`*.{ts,tsx}\` — TypeScript and TSX files
      - \`Dockerfile*\` — Dockerfile and variants

      ### Best Practices
      - Use specific patterns and small \`maxResults\` to limit output
      - For listing a single folder: set \`includeSubdirectories=false\` with \`filenamePattern="*"\`
      - Common build/cache folders (node_modules, dist, .next, etc.) are excluded by default
      - Use \`maxDepth\` to limit recursion depth for large repos
      - Use \`skipPatterns\` to exclude additional directories: \`["test/**", "docs/**"]\`

      ### Output Format
      Returns an object with:
      - \`files\` — array of absolute file paths
      - \`cwd\` — the working directory used for the search
      - \`returned\` — number of paths returned
      - \`truncated\` — true if more results exist beyond \`maxResults\`

      ### Examples
      **1. Find TypeScript files:**
      \`\`\`json
      {"searchInDirectory":"/repo/src","filenamePattern":"*.ts","maxResults":50}
      \`\`\`

      **2. List directory contents (non-recursive):**
      \`\`\`json
      {"searchInDirectory":"/repo/src/modules","filenamePattern":"*","includeSubdirectories":false}
      \`\`\`

      **3. Find migration files:**
      \`\`\`json
      {"searchInDirectory":"/repo","filenamePattern":"*migration*","maxResults":20}
      \`\`\`

      **4. Find config files with custom exclusions:**
      \`\`\`json
      {"searchInDirectory":"/repo","filenamePattern":"*.config.*","skipPatterns":["node_modules/**","dist/**","test/**"]}
      \`\`\`
    `;
  }

  public get schema() {
    return FilesFindPathsToolSchema;
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
        : this.defaultSkipPatterns;

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

    if (res.exitCode !== 0) {
      return {
        output: {
          error: res.stderr || res.stdout || 'Failed to find paths',
          files: [],
          cwd: (args.searchInDirectory ?? '').trim(),
          returned: 0,
          truncated: false,
        },
        messageMetadata,
      };
    }

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

    return {
      output: {
        files,
        cwd,
        returned: files.length,
        truncated,
      },
      messageMetadata,
    };
  }
}
