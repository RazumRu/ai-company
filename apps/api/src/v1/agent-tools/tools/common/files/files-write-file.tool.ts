import { Buffer } from 'node:buffer';
import { basename, dirname } from 'node:path';

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

export const FilesWriteFileToolSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe('Absolute path to the file you want to write.'),
  fileContent: z
    .string()
    .describe(
      'Full content to write to the file. Note: This will overwrite any existing contents.',
    ),
});

export type FilesWriteFileToolSchemaType = z.infer<
  typeof FilesWriteFileToolSchema
>;

type FilesWriteFileToolOutput = {
  success?: boolean;
  error?: string;
};

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class FilesWriteFileTool extends FilesBaseTool<FilesWriteFileToolSchemaType> {
  public name = 'files_write_file';
  public description =
    'Write a file by full overwrite (destructive: replaces entire contents).';

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
      Overwrites the entire file. Use ONLY for new files or intentional full rewrites.

      ### When to Use
      - Creating a brand-new file from scratch
      - Generating a file that does not exist yet
      - Intentional full-file replacement (rare)

      ### When NOT to Use
      - Editing existing files -> use \`files_edit\` or \`files_apply_changes\`
      - Deleting files -> use \`files_delete\`

      ### Safety Tips
      - If the file might exist, read it first (\`files_read\`) to avoid data loss.
      - Create parent folders if needed (\`files_create_directory\`).
      - Prefer \`files_apply_changes\` if you can express the change as oldText/newText.

      ### Example (new file)
      \`\`\`json
      {"filePath":"/repo/new-config.json","fileContent":"{\\n  \\"version\\": \\"2.0\\"\\n}"}
      \`\`\`
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
