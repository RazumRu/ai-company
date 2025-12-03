import { Buffer } from 'node:buffer';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

export const FilesApplyChangesToolSchema = z.object({
  filePath: z.string().min(1).describe('Absolute path to the file to modify'),
  operation: z
    .enum(['replace', 'replace_range', 'insert', 'delete'])
    .describe('Type of operation to perform'),
  content: z
    .string()
    .optional()
    .describe(
      'New content to write (required for replace, replace_range, and insert operations)',
    ),
  startLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Starting line number (1-based, required for replace_range, insert, and delete operations)',
    ),
  endLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Ending line number (1-based, required for replace_range and delete operations)',
    ),
});

export type FilesApplyChangesToolSchemaType = z.infer<
  typeof FilesApplyChangesToolSchema
>;

type FilesApplyChangesToolOutput = {
  error?: string;
  success?: boolean;
  lineCount?: number;
};

@Injectable()
export class FilesApplyChangesTool extends FilesBaseTool<FilesApplyChangesToolSchemaType> {
  public name = 'files_apply_changes';
  public description =
    'Apply changes to a file in a repository directory. Supports replacing entire file, replacing line ranges, inserting content at specific lines, and deleting line ranges. Returns success status and updated line count.';

  public get schema() {
    return FilesApplyChangesToolSchema;
  }

  public async invoke(
    args: FilesApplyChangesToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<FilesApplyChangesToolOutput> {
    if (
      (args.operation === 'replace' ||
        args.operation === 'replace_range' ||
        args.operation === 'insert') &&
      args.content === undefined
    ) {
      return {
        error: `content is required for ${args.operation} operation`,
        success: false,
      };
    }

    if (
      (args.operation === 'replace_range' ||
        args.operation === 'insert' ||
        args.operation === 'delete') &&
      args.startLine === undefined
    ) {
      return {
        error: `startLine is required for ${args.operation} operation`,
        success: false,
      };
    }

    if (
      (args.operation === 'replace_range' || args.operation === 'delete') &&
      args.endLine === undefined
    ) {
      return {
        error: `endLine is required for ${args.operation} operation`,
        success: false,
      };
    }

    if (
      args.startLine !== undefined &&
      args.endLine !== undefined &&
      args.startLine > args.endLine
    ) {
      return {
        error: 'startLine must be less than or equal to endLine',
        success: false,
      };
    }

    const fullFilePath = args.filePath;
    let cmd: string;

    const contentBase64 =
      args.content !== undefined
        ? Buffer.from(args.content, 'utf8').toString('base64')
        : '';

    switch (args.operation) {
      case 'replace': {
        const tempFile = `${fullFilePath}.tmp.${Date.now()}`;
        cmd = `echo '${contentBase64}' | base64 -d > "${tempFile}" && mv "${tempFile}" "${fullFilePath}"`;
        break;
      }

      case 'replace_range': {
        const tempFile = `${fullFilePath}.tmp.${Date.now()}`;
        const newContentFile = `${fullFilePath}.new.${Date.now()}`;
        cmd = `echo '${contentBase64}' | base64 -d > "${newContentFile}" && awk -v start=${args.startLine} -v end=${args.endLine} -v newfile="${newContentFile}" 'NR==start{while((getline line < newfile) > 0) print line; close(newfile)} NR<start || NR>end' "${fullFilePath}" > "${tempFile}" && mv "${tempFile}" "${fullFilePath}" && rm -f "${newContentFile}"`;
        break;
      }

      case 'insert': {
        const tempFile = `${fullFilePath}.tmp.${Date.now()}`;
        const newContentFile = `${fullFilePath}.new.${Date.now()}`;
        if (args.startLine === 1) {
          cmd = `echo '${contentBase64}' | base64 -d > "${newContentFile}" && cat "${newContentFile}" "${fullFilePath}" > "${tempFile}" && mv "${tempFile}" "${fullFilePath}" && rm -f "${newContentFile}"`;
        } else {
          const insertLine = args.startLine! - 1;
          cmd = `echo '${contentBase64}' | base64 -d > "${newContentFile}" && sed -e "${insertLine}r ${newContentFile}" "${fullFilePath}" > "${tempFile}" && mv "${tempFile}" "${fullFilePath}" && rm -f "${newContentFile}"`;
        }
        break;
      }

      case 'delete': {
        const tempFile = `${fullFilePath}.tmp.${Date.now()}`;
        cmd = `sed '${args.startLine},${args.endLine}d' "${fullFilePath}" > "${tempFile}" && mv "${tempFile}" "${fullFilePath}"`;
        break;
      }

      default:
        return {
          error: `Unknown operation: ${args.operation}`,
          success: false,
        };
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
        error: res.stderr || res.stdout || 'Failed to apply changes',
        success: false,
      };
    }

    const countRes = await this.execCommand(
      {
        cmd: `wc -l < "${fullFilePath}"`,
      },
      config,
      cfg,
    );

    const lineCount =
      countRes.exitCode === 0
        ? parseInt(countRes.stdout.trim(), 10) || 0
        : undefined;

    return {
      success: true,
      lineCount,
    };
  }
}
