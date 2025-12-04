import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

export const FilesListToolSchema = z.object({
  dir: z
    .string()
    .min(1)
    .describe('Path to the repository directory to search in.'),
  pattern: z
    .string()
    .optional()
    .describe('Optional pattern to filter files (e.g., "*.ts", "src/**").'),
});

export type FilesListToolSchemaType = z.infer<typeof FilesListToolSchema>;

type FilesListToolOutput = {
  error?: string;
  files?: string[];
};

@Injectable()
export class FilesListTool extends FilesBaseTool<FilesListToolSchemaType> {
  public name = 'files_list';
  public description =
    'List files in a repository directory using fd (find). Supports optional pattern filtering. Returns an array of absolute file paths. The paths returned can be used directly with files_read, files_apply_changes, and files_search_text.filePath.';

  public get schema() {
    return FilesListToolSchema;
  }

  public async invoke(
    args: FilesListToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<FilesListToolOutput> {
    const cmdParts: string[] = [
      `cd "${args.dir}"`,
      '&&',
      'fd',
      '--absolute-path',
    ];

    if (args.pattern) {
      cmdParts.push('--glob', `"${args.pattern}"`);
    }

    cmdParts.push('--type', 'f', '--hidden', '--exclude', '.git');

    const cmd = cmdParts.join(' ');

    const res = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      return {
        error: res.stderr || res.stdout || 'Failed to list files',
      };
    }

    // Split stdout by newlines and filter out empty strings
    const files = res.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return {
      files,
    };
  }
}
