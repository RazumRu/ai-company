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
    'Write/overwrite a file at an absolute path with the provided full content. This is a full replace operation (destructive).';

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
    const parameterDocs = this.getSchemaParameterDocs(this.schema);
    return dedent`
      ### Overview
      Overwrites an entire file with provided content (**destructive**). Prefer \`files_apply_changes\` for targeted edits; use this tool only when you intend to replace the whole file.

      ${parameterDocs}

      ### When to Use
      - Creating a new file from scratch (and you have the full content)
      - Replacing a generated file entirely (regenerate then overwrite)
      - Writing small config files where full overwrite is intended

      ### When NOT to Use
      - Small/targeted edits → use \`files_apply_changes\` (safer)
      - You only need to append/insert a snippet → use \`files_apply_changes\`
      - You need to delete a file → use \`files_delete\`

      ### Best Practices
      - If modifying an existing file, read it first with \`files_read\` to avoid accidental loss.
      - For multi-step generation, create directories first using \`files_create_directory\`.
      - Keep overwrites intentional and scoped; don’t overwrite large files unless necessary.

      ### Examples
      **1) Create/overwrite a small file:**
      \`\`\`json
      { "path": "/repo/README.generated.md", "content": "# Generated\\n\\nDo not edit by hand.\\n" }
      \`\`\`

      **2) Workflow (mkdir → write → verify):**
      1) \`files_create_directory\`:
      \`\`\`json
      { "path": "/repo/generated" }
      \`\`\`
      2) \`files_write_file\`:
      \`\`\`json
      { "path": "/repo/generated/output.json", "content": "{\\n  \\"ok\\": true\\n}\\n" }
      \`\`\`
      3) \`files_read\`:
      \`\`\`json
      { "filePaths": ["/repo/generated/output.json"] }
      \`\`\`

      ### Output Format
      Success:
      \`\`\`json
      { "success": true }
      \`\`\`
      Error:
      \`\`\`json
      { "success": false, "error": "..." }
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
