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

export const FilesCreateDirectoryToolSchema = z.object({
  path: z.string().min(1).describe('Absolute path to the directory to create.'),
});

export type FilesCreateDirectoryToolSchemaType = z.infer<
  typeof FilesCreateDirectoryToolSchema
>;

type FilesCreateDirectoryToolOutput = {
  success?: boolean;
  error?: string;
};

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class FilesCreateDirectoryTool extends FilesBaseTool<FilesCreateDirectoryToolSchemaType> {
  public name = 'files_create_directory';
  public description = 'Create a directory (mkdir -p) at an absolute path.';

  protected override generateTitle(
    args: FilesCreateDirectoryToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    return `Creating directory: ${basename(args.path) || args.path}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Creates directory using mkdir -p (including parents). Safe if directory already exists.

      ### When to Use
      Before writing file into new folder (with files_write_file/files_apply_changes). Creating folder structure for generated code or fixtures.

      ### When NOT to Use
      For creating files → use files_write_file or files_apply_changes. For renaming/moving → use files_move_file.

      ### Example
      \`\`\`json
      {"path": "/repo/generated/client"}
      \`\`\`
    `;
  }

  public get schema() {
    return z.toJSONSchema(FilesCreateDirectoryToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public async invoke(
    args: FilesCreateDirectoryToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesCreateDirectoryToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const res = await this.execCommand(
      { cmd: `mkdir -p ${shQuote(args.path)}` },
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
