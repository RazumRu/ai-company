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
    .describe('Absolute path to the file that should be deleted.'),
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
    'Delete a file by absolute path. Intended for cleanup of generated or temporary files. Works with paths returned from files_list. Returns success or error message.';

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
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Removes a single file at the provided absolute path. Designed for cleaning up generated artifacts, temporary files, or test fixtures. Rejects directories to prevent accidental recursive deletion.

      ### When to Use
      - Cleaning up files created during tool runs or tests
      - Removing generated artifacts before re-creating them
      - Deleting temporary notes or scratch files

      ### When NOT to Use
      - Deleting directories or large trees (not supported)
      - Modifying file contents → use files_apply_changes
      - Listing or reading files → use files_list or files_read

      ${parameterDocs}

      ### Best Practices
      - Always confirm the file path via files_list/files_read before deleting
      - Avoid deleting shared project files unless you just created them
      - This tool only deletes files; it will fail on directories

      ### Output
      Success:
      \`\`\`json
      { "success": true }
      \`\`\`

      Error:
      \`\`\`json
      { "success": false, "error": "File not found" }
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
