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

export const FilesMoveFileToolSchema = z.object({
  source: z.string().min(1).describe('Absolute path to the source file.'),
  destination: z
    .string()
    .min(1)
    .describe('Absolute path to the destination file path.'),
});

export type FilesMoveFileToolSchemaType = z.infer<
  typeof FilesMoveFileToolSchema
>;

type FilesMoveFileToolOutput = {
  success?: boolean;
  error?: string;
};

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class FilesMoveFileTool extends FilesBaseTool<FilesMoveFileToolSchemaType> {
  public name = 'files_move_file';
  public description =
    'Move/rename a file (source → destination); creates destination parent directories.';

  protected override generateTitle(
    args: FilesMoveFileToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const src = basename(args.source);
    const dst = basename(args.destination);
    return src === dst ? `Moving ${src}` : `Renaming ${src} → ${dst}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Moves/renames file using mv. Creates destination parent directories automatically.

      ### When to Use
      Renaming file (same directory) or moving file to new folder.

      ### When NOT to Use
      For copying (this moves, not copies). For editing content → use files_apply_changes or files_write_file.

      ### Examples
      **1. Rename:**
      \`\`\`json
      {"source": "/repo/src/old-name.ts", "destination": "/repo/src/new-name.ts"}
      \`\`\`

      **2. Move:**
      \`\`\`json
      {"source": "/repo/tmp/output.json", "destination": "/repo/generated/output.json"}
      \`\`\`
    `;
  }

  public get schema() {
    return z.toJSONSchema(FilesMoveFileToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public async invoke(
    args: FilesMoveFileToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesMoveFileToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const cmd = [
      `__destDir=$(dirname -- ${shQuote(args.destination)})`,
      'mkdir -p "$__destDir"',
      `mv -- ${shQuote(args.source)} ${shQuote(args.destination)}`,
    ].join(' && ');

    const res = await this.execCommand({ cmd }, config, cfg);
    if (res.exitCode !== 0) {
      return {
        output: { success: false, error: res.stderr || res.stdout || 'Failed' },
        messageMetadata,
      };
    }

    return { output: { success: true }, messageMetadata };
  }
}
