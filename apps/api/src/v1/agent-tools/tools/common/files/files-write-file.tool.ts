import { Buffer } from 'node:buffer';
import { basename, dirname } from 'node:path';

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

export const FilesWriteFileToolSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe(
      'Absolute path to the file to create or overwrite (must start with /runtime-workspace/). Parent directories are created automatically.',
    ),
  fileContent: z
    .string()
    .describe(
      'The complete file content to write. This fully replaces any existing file content — there is no append mode.',
    ),
});

export type FilesWriteFileToolSchemaType = z.infer<
  typeof FilesWriteFileToolSchema
>;

type FilesWriteFileToolOutput = {
  success?: boolean;
  error?: string;
};

@Injectable()
export class FilesWriteFileTool extends FilesBaseTool<FilesWriteFileToolSchemaType> {
  public name = 'files_write_file';
  public description =
    'Create a new file or completely overwrite an existing file with the provided content. Parent directories are created automatically. This tool should primarily be used for creating new files from scratch. For editing existing files, prefer files_apply_changes (precise replacements) or files_edit (sketch-based edits), as they preserve unmodified content. If the file already exists, read it first with files_read to avoid accidental data loss.';

  protected override generateTitle(
    args: FilesWriteFileToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    return `Writing ${basename(args.filePath)}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Create a new file or fully overwrite an existing one. Parent directories are created automatically.

      ### When to Use
      - Creating new files from scratch
      - Full-file replacement (rare — prefer \`files_apply_changes\` for edits)

      ### Safety
      - If the file might exist, read it first (\`files_read\`) to avoid data loss
    `;
  }

  public get schema() {
    return FilesWriteFileToolSchema;
  }

  public async invoke(
    args: FilesWriteFileToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesWriteFileToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const parentDir = dirname(args.filePath);
    const tempFile = `${args.filePath}.tmp.${Date.now()}`;
    const contentBase64 = Buffer.from(args.fileContent, 'utf8').toString(
      'base64',
    );

    const cmd = [
      `mkdir -p ${shQuote(parentDir)}`,
      `echo ${shQuote(contentBase64)} | base64 -d > ${shQuote(tempFile)}`,
      `mv -- ${shQuote(tempFile)} ${shQuote(args.filePath)}`,
    ].join(' && ');

    const res = await this.execCommand({ cmd }, config, cfg);
    if (res.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: res.stderr || res.stdout || 'Failed to write file',
        },
        messageMetadata,
      };
    }

    return { output: { success: true }, messageMetadata };
  }
}
