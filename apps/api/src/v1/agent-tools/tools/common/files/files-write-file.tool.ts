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
  path: z.string().min(1).describe('Absolute path to the file to write.'),
  content: z
    .string()
    .describe('Full file content to write. This overwrites the whole file.'),
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
    return `Writing ${basename(args.path)}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Overwrites entire file (**destructive**). Prefer \`files_apply_changes\` for targeted edits.

      ### When to Use / NOT to Use
      Use for: new files from scratch, full regeneration of files, small config overwrites.
      Don't use for: targeted edits (use \`files_apply_changes\`), deletion (use \`files_delete\`), append/insert snippets (use \`files_apply_changes\`).

      ### Best Practice
      Read file first with \`files_read\` before overwriting to avoid data loss. Create parent directories first using \`files_create_directory\` if needed.

      ### Example
      \`\`\`json
      {"path": "/repo/config.json", "content": "{\\n  \\"version\\": \\"2.0\\"\\n}"}
      \`\`\`
    `;
  }

  public get schema() {
    return z.toJSONSchema(FilesWriteFileToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public async invoke(
    args: FilesWriteFileToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesWriteFileToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const parentDir = dirname(args.path);
    const tempFile = `${args.path}.tmp.${Date.now()}`;
    const contentBase64 = Buffer.from(args.content, 'utf8').toString('base64');

    const cmd = [
      `mkdir -p ${shQuote(parentDir)}`,
      `echo ${shQuote(contentBase64)} | base64 -d > ${shQuote(tempFile)}`,
      `mv -- ${shQuote(tempFile)} ${shQuote(args.path)}`,
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
