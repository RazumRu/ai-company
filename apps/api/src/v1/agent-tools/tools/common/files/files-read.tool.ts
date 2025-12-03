import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import {
  FilesBaseTool,
  FilesBaseToolConfig,
  FilesBaseToolSchema,
} from './files-base.tool';

export const FilesReadToolSchema = FilesBaseToolSchema.extend({
  filePath: z
    .string()
    .min(1)
    .describe(
      'Path to the file to read, relative to the repository directory.',
    ),
  startLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Optional starting line number (1-based). If provided, only reads lines from startLine to endLine.',
    ),
  endLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Optional ending line number (1-based). Must be provided if startLine is provided.',
    ),
});

export type FilesReadToolSchemaType = z.infer<typeof FilesReadToolSchema>;

type FilesReadToolOutput = {
  error?: string;
  content?: string;
  lineCount?: number;
};

@Injectable()
export class FilesReadTool extends FilesBaseTool<FilesReadToolSchemaType> {
  public name = 'files_read';
  public description =
    'Read the contents of a file in a repository directory. Optionally read specific line ranges using startLine and endLine parameters. Returns the file content and line count.';

  public get schema() {
    return FilesReadToolSchema;
  }

  public async invoke(
    args: FilesReadToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<FilesReadToolOutput> {
    // Validate that if startLine is provided, endLine must also be provided
    if (args.startLine !== undefined && args.endLine === undefined) {
      return {
        error: 'endLine must be provided when startLine is specified',
      };
    }

    if (args.endLine !== undefined && args.startLine === undefined) {
      return {
        error: 'startLine must be provided when endLine is specified',
      };
    }

    if (
      args.startLine !== undefined &&
      args.endLine !== undefined &&
      args.startLine > args.endLine
    ) {
      return {
        error: 'startLine must be less than or equal to endLine',
      };
    }

    const fullFilePath = `${args.repoDir}/${args.filePath}`;

    let cmd: string;
    if (args.startLine !== undefined && args.endLine !== undefined) {
      // Use sed to read specific line range
      cmd = `cd "${args.repoDir}" && sed -n '${args.startLine},${args.endLine}p' "${fullFilePath}"`;
    } else {
      // Use cat to read entire file
      cmd = `cd "${args.repoDir}" && cat "${fullFilePath}"`;
    }

    const res = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      return {
        error: res.stderr || res.stdout || 'Failed to read file',
      };
    }

    const content = res.stdout;
    const lineCount = content.split('\n').length;

    return {
      content,
      lineCount,
    };
  }
}
