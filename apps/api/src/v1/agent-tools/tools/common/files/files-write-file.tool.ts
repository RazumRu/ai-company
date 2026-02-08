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
      'Absolute path to the file to create or overwrite. Parent directories are created automatically.',
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
    'Create a new file or completely overwrite an existing file with the provided content. Parent directories are created automatically. Primarily for new files — for editing existing files, prefer files_apply_changes or files_edit as they preserve unmodified content.';

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
      - Creating brand-new files (new modules, configs, scripts, tests)
      - Generating boilerplate or scaffolding files
      - Writing output files (reports, generated code)

      ### When NOT to Use
      - Editing existing files → use \`files_apply_changes\` (precise text replacement) or \`files_edit\` (sketch-based)
      - Appending to a file → use \`files_apply_changes\` with \`insertAfterLine\`
      - Small changes to large files → edit tools are safer and more efficient

      ### Safety
      - If the file might already exist, **always** read it first with \`files_read\` to avoid accidental data loss
      - This tool fully replaces file content — there is no append or merge mode
      - Provide the **complete** file content; partial content will result in a truncated file

      ### Best Practices
      - Use absolute paths
      - Include proper file headers, imports, and structure for the target language
      - For large files, consider whether \`files_edit\` with a sketch would be more appropriate

      ### Examples
      **1. Create a new TypeScript module:**
      \`\`\`json
      {"filePath": "/runtime-workspace/project/src/utils/validation.ts", "fileContent": "export function isEmail(value: string): boolean {\\n  return /^[^@]+@[^@]+$/.test(value);\\n}\\n"}
      \`\`\`

      **2. Create a configuration file:**
      \`\`\`json
      {"filePath": "/runtime-workspace/project/.eslintrc.json", "fileContent": "{\\n  \\"extends\\": [\\"eslint:recommended\\"]\\n}\\n"}
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
