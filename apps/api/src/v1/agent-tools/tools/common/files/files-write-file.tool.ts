import { Buffer } from 'node:buffer';
import { basename, dirname } from 'node:path';

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
      Overwrites entire file (**DESTRUCTIVE** - replaces all content). This is a **LAST RESORT** for editing existing files.

      ### ⚠️ WARNING: High Risk of Data Loss
      This tool replaces the ENTIRE file. Any content not in \`fileContent\` will be LOST.
      For existing files, you almost always want a different tool.

      ### Tool Selection Priority (Use in Order)
      1. **Editing existing files?** → Use \`files_edit\` (sketch-based)
      2. **Edit failed?** → Use \`files_apply_changes\` (oldText/newText)
      3. **Creating new file?** → Use \`files_write_file\` (this tool - ONLY for new files)

      ### When to Use
      - **Creating brand new files from scratch**
      - Generating configuration files that don't exist
      - Intentional complete file replacement (rare)

      ### When NOT to Use (Critical)
      - **Modifying existing files** → HIGH RISK - use \`files_edit\` or \`files_apply_changes\`
      - Small changes to files → use \`files_edit\` or \`files_apply_changes\`
      - File might have been updated → risk of losing changes
      - Deleting files → use \`files_delete\`
      - Adding/changing parts of files → use \`files_edit\` or \`files_apply_changes\`

      ### Best Practice
      - For existing files: Read with \`files_read\` first to verify it's safe to overwrite
      - For new files: Create parent directories with \`files_create_directory\` if needed
      - If modifying: Use \`files_edit\` or \`files_apply_changes\` instead

      ### Example (New File Only)
      \`\`\`json
      {"filePath": "/repo/new-config.json", "fileContent": "{\\n  \\"version\\": \\"2.0\\"\\n}"}
      \`\`\`
    `;
  }

  public get schema() {
    return zodToAjvSchema(FilesWriteFileToolSchema);
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
