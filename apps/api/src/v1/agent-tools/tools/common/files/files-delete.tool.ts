import { basename } from 'node:path';

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

export const FilesDeleteToolSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe(
      'Absolute path to the file to delete. Must point to a file, not a directory. Verify the path with files_find_paths or files_read before deleting.',
    ),
});

export type FilesDeleteToolSchemaType = z.infer<typeof FilesDeleteToolSchema>;

type FilesDeleteToolOutput = {
  success?: boolean;
  error?: string;
};

@Injectable()
export class FilesDeleteTool extends FilesBaseTool<FilesDeleteToolSchemaType> {
  public name = 'files_delete';
  public description =
    'Permanently delete a single file by absolute path. This operation is destructive and cannot be undone. Only files are accepted — directories are rejected with an error. Before deleting, verify the path using files_find_paths or files_read to avoid accidental removal of the wrong file. Do not use this for editing content; use files_apply_changes instead.';

  protected override generateTitle(
    args: FilesDeleteToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    return `Deleting ${basename(args.filePath)}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Delete a single file by absolute path. Rejects directories.

      ### When to Use
      - Cleaning up generated or temporary files
      - Removing a file you just created

      ### When NOT to Use
      - Deleting directories
      - Editing content -> \`files_apply_changes\`

      ### Best Practices
      - Confirm the path with \`files_find_paths\` or \`files_read\` before deleting.
      - Avoid deleting shared project files unless you just created them.

      ### Example
      \`\`\`json
      {"filePath":"/repo/tmp/debug.log"}
      \`\`\`
    `;
  }

  public get schema() {
    return FilesDeleteToolSchema;
  }

  public async invoke(
    args: FilesDeleteToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesDeleteToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };
    const fullFilePath = args.filePath;
    const cmd = [
      `if [ ! -e "${fullFilePath}" ]; then`,
      '  echo "File not found" >&2;',
      '  exit 1;',
      'fi;',
      `if [ -d "${fullFilePath}" ]; then`,
      '  echo "Path is a directory; only files can be deleted" >&2;',
      '  exit 1;',
      'fi;',
      `rm -f "${fullFilePath}"`,
    ].join(' ');

    const res = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: res.stderr || res.stdout || 'Failed to delete file',
        },
        messageMetadata,
      };
    }

    return {
      output: {
        success: true,
      },
      messageMetadata,
    };
  }
}
