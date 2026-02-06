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

export const FilesCreateDirectoryToolSchema = z.object({
  directoryPath: z
    .string()
    .min(1)
    .describe('Absolute path to the directory to create.'),
});

export type FilesCreateDirectoryToolSchemaType = z.infer<
  typeof FilesCreateDirectoryToolSchema
>;

type FilesCreateDirectoryToolOutput = {
  success?: boolean;
  error?: string;
};

@Injectable()
export class FilesCreateDirectoryTool extends FilesBaseTool<FilesCreateDirectoryToolSchemaType> {
  public name = 'files_create_directory';
  public description = 'Create a directory (mkdir -p) at an absolute path.';

  protected override generateTitle(
    args: FilesCreateDirectoryToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    return `Creating directory: ${basename(args.directoryPath) || args.directoryPath}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Create a directory (mkdir -p). Safe if it already exists.

      ### When to Use
      - Preparing parent folders before writing files
      - Creating scaffolding for generated output

      ### When NOT to Use
      - Creating files -> \`files_write_file\` or \`files_apply_changes\`
      - Moving/renaming -> \`files_move_file\`

      ### Example
      \`\`\`json
      {"directoryPath":"/repo/generated/client"}
      \`\`\`
    `;
  }

  public get schema() {
    return FilesCreateDirectoryToolSchema;
  }

  public async invoke(
    args: FilesCreateDirectoryToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesCreateDirectoryToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const res = await this.execCommand(
      { cmd: `mkdir -p ${shQuote(args.directoryPath)}` },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      return {
        output: { success: false, error: res.stderr || res.stdout || 'Failed' },
        messageMetadata,
      };
    }

    return { output: { success: true }, messageMetadata };
  }
}
