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
    .describe(
      'Absolute path to the directory to create (e.g., "/runtime-workspace/project/src/utils"). All missing parent directories are created automatically.',
    ),
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
  public description =
    'Create a directory at an absolute path, including any missing parent directories (equivalent to mkdir -p). Safe to call if the directory already exists — it will succeed without error. Use this to prepare directory structures before writing files with files_write_file. For creating files, use files_write_file instead. For moving or renaming, use files_move_file.';

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
      Create a directory at an absolute path, including any missing parent directories (equivalent to \`mkdir -p\`). This operation is **idempotent** — calling it on an existing directory succeeds without error.

      ### When to Use
      - Preparing directory structure before writing files with \`files_write_file\`
      - Creating scaffolding for generated output or new modules
      - Ensuring a directory exists before moving files into it (though \`files_move_file\` creates parents automatically)

      ### When NOT to Use
      - Creating files → use \`files_write_file\` (it creates parent directories automatically)
      - Moving or renaming files/directories → use \`files_move_file\` or shell \`mv\`
      - Deleting directories → use shell \`rm -rf\`

      ### Best Practices
      - Use absolute paths (e.g., \`/runtime-workspace/project/src/utils\`)
      - No need to check if the directory exists first — the tool is idempotent
      - Note that \`files_write_file\` and \`files_move_file\` both create parent directories automatically, so you rarely need this tool explicitly

      ### Error Cases
      - Permission denied → the path cannot be created due to filesystem permissions
      - Path conflicts → a file (not directory) already exists at the exact path

      ### Examples
      **1. Create a new module directory:**
      \`\`\`json
      {"directoryPath":"/repo/src/modules/notifications"}
      \`\`\`

      **2. Create nested directories for generated output:**
      \`\`\`json
      {"directoryPath":"/repo/generated/api-client/types"}
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
