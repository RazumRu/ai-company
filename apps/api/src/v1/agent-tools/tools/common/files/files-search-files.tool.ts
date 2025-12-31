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

export const FilesSearchFilesToolSchema = z.object({
  dir: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Directory path to search. If omitted, uses the current working directory of the persistent shell session.',
    ),
  pattern: z
    .string()
    .min(1)
    .describe(
      'Glob pattern to match file names/paths. Uses fd glob syntax (e.g., "*.ts", "**/*.md", "src/**").',
    ),
  excludePatterns: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional array of glob patterns to exclude (e.g., ["node_modules/**", "dist/**"]).',
    ),
});

export type FilesSearchFilesToolSchemaType = z.infer<
  typeof FilesSearchFilesToolSchema
>;

type FilesSearchFilesToolOutput = {
  error?: string;
  files?: string[];
};

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class FilesSearchFilesTool extends FilesBaseTool<FilesSearchFilesToolSchemaType> {
  public name = 'files_search_files';
  public description =
    'Search for files by name using fd (glob match). Returns an array of absolute file paths. Use this when you need filename-based discovery (not content search).';

  protected override generateTitle(
    args: FilesSearchFilesToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const location = args.dir ?? 'current directory';
    return `Searching files in ${location}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Recursively searches for files by filename/path glob using \`fd\` (fast alternative to \`find\`). Returns absolute paths that you can pass directly into \`files_read\`, \`files_apply_changes\`, \`files_delete\`, etc.

      **Important**: This tool searches file **NAMES/PATHS** only. If you want to search file **CONTENT**, use \`files_search_text\`.

      ${parameterDocs}

      ### When to Use
      - Finding files by extension (e.g., all \`.ts\` files)
      - Locating config files (\`package.json\`, \`tsconfig.json\`, \`eslint.config.*\`)
      - Gathering a list of files before batch reading with \`files_read\`
      - Finding tests/specs by filename patterns

      ### When NOT to Use
      - Searching text inside files → use \`files_search_text\`
      - You already know the exact path(s) → go straight to \`files_read\`

      ### Best Practices
      - Prefer scoping with \`dir\` if you can (fewer files scanned).
      - Add \`excludePatterns\` for large repos to keep results clean and fast.
      - For follow-up reading, pass returned paths directly into \`files_read\`.

      ### Examples
      **1) Find all TypeScript files:**
      \`\`\`json
      { "dir": "/repo", "pattern": "**/*.ts" }
      \`\`\`

      **2) Find a specific config file anywhere:**
      \`\`\`json
      { "dir": "/repo", "pattern": "**/tsconfig*.json" }
      \`\`\`

      **3) Exclude common junk dirs (recommended):**
      \`\`\`json
      { "dir": "/repo", "pattern": "**/*.ts", "excludePatterns": ["node_modules/**", "dist/**"] }
      \`\`\`

      **4) Typical workflow (search → batch read):**
      \`\`\`json
      { "dir": "/repo", "pattern": "**/*.{ts,tsx}", "excludePatterns": ["node_modules/**", "dist/**", "build/**"] }
      \`\`\`
      Then take the returned \`files\` array and call:
      \`\`\`json
      { "filePaths": ["...first.ts", "...second.ts"] }
      \`\`\`

      ### Output Format
      \`\`\`json
      { "files": ["/repo/src/a.ts", "/repo/src/b.ts"] }
      \`\`\`
      Or on error:
      \`\`\`json
      { "error": "..." }
      \`\`\`
    `;
  }

  public get schema() {
    return z.toJSONSchema(FilesSearchFilesToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    }) as ReturnType<typeof z.toJSONSchema>;
  }

  public async invoke(
    args: FilesSearchFilesToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesSearchFilesToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const cmdParts: string[] = [
      'fd',
      '--absolute-path',
      '--type',
      'f',
      '--hidden',
      '--exclude',
      '.git',
      '--glob',
      shQuote(args.pattern),
    ];

    if (args.excludePatterns && args.excludePatterns.length > 0) {
      for (const ex of args.excludePatterns) {
        cmdParts.push('--exclude', shQuote(ex));
      }
    }

    const baseCmd = cmdParts.join(' ');
    const cmd = args.dir ? `cd ${shQuote(args.dir)} && ${baseCmd}` : baseCmd;

    const res = await this.execCommand({ cmd }, config, cfg);
    if (res.exitCode !== 0) {
      return {
        output: { error: res.stderr || res.stdout || 'Failed to search files' },
        messageMetadata,
      };
    }

    const files = res.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return { output: { files }, messageMetadata };
  }
}
