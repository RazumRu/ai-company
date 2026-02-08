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

export const FilesMoveFileToolSchema = z.object({
  sourcePath: z
    .string()
    .min(1)
    .describe(
      'Absolute path to the file to move or rename. The file must exist.',
    ),
  destinationPath: z
    .string()
    .min(1)
    .describe(
      'Absolute path for the new location. Parent directories are created automatically if they do not exist.',
    ),
});

export type FilesMoveFileToolSchemaType = z.infer<
  typeof FilesMoveFileToolSchema
>;

type FilesMoveFileToolOutput = {
  success?: boolean;
  error?: string;
};

@Injectable()
export class FilesMoveFileTool extends FilesBaseTool<FilesMoveFileToolSchemaType> {
  public name = 'files_move_file';
  public description =
    'Move or rename a file from sourcePath to destinationPath. Parent directories for the destination are created automatically if they do not exist. This is a move operation, not a copy — the source file will no longer exist after a successful call. Use this for renaming files or reorganizing directory structures. Do not use for editing file content — use files_apply_changes instead.';

  protected override generateTitle(
    args: FilesMoveFileToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const src = basename(args.sourcePath);
    const dst = basename(args.destinationPath);
    return src === dst ? `Moving ${src}` : `Renaming ${src} → ${dst}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Move or rename a single file from \`sourcePath\` to \`destinationPath\`. Parent directories for the destination are created automatically. This is a **move** operation — the source file will no longer exist after success.

      ### When to Use
      - Renaming a file (same directory, different name)
      - Moving a file to a different directory
      - Reorganizing project structure (move files into new folders)

      ### When NOT to Use
      - Copying a file (this tool removes the source) → use shell \`cp\` instead
      - Moving directories → use shell \`mv\` instead
      - Editing file content → use \`files_apply_changes\`
      - Creating new files → use \`files_write_file\`

      ### Best Practices
      - Verify the source path exists before moving (use \`files_find_paths\` or \`files_read\`)
      - If a file already exists at \`destinationPath\`, it will be **overwritten silently**
      - After moving, update any import/require statements in other files that reference the old path
      - Both paths must be absolute

      ### Error Cases
      - Source file does not exist → operation fails
      - Source is a directory → use shell \`mv\` instead
      - Permission denied → check file/directory permissions

      ### Examples
      **1. Rename a file:**
      \`\`\`json
      {"sourcePath":"/repo/src/old-name.ts","destinationPath":"/repo/src/new-name.ts"}
      \`\`\`

      **2. Move to a new folder (parent created automatically):**
      \`\`\`json
      {"sourcePath":"/repo/tmp/output.json","destinationPath":"/repo/generated/output.json"}
      \`\`\`

      **3. Reorganize module structure:**
      \`\`\`json
      {"sourcePath":"/repo/src/utils.ts","destinationPath":"/repo/src/utils/index.ts"}
      \`\`\`
    `;
  }

  public get schema() {
    return FilesMoveFileToolSchema;
  }

  public async invoke(
    args: FilesMoveFileToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesMoveFileToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const cmd = [
      `__destDir=$(dirname -- ${shQuote(args.destinationPath)})`,
      'mkdir -p "$__destDir"',
      `mv -- ${shQuote(args.sourcePath)} ${shQuote(args.destinationPath)}`,
    ].join(' && ');

    const res = await this.execCommand({ cmd }, config, cfg);
    if (res.exitCode !== 0) {
      return {
        output: { success: false, error: res.stderr || res.stdout || 'Failed' },
        messageMetadata,
      };
    }

    return { output: { success: true }, messageMetadata };
  }
}
