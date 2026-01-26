import { randomUUID } from 'node:crypto';
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

const FilesReadToolReadSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe(
      'Path to the file you want to read. Can use paths directly from `files_find_paths` output.',
    ),
  fromLineNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Start reading from this line number (1-based, optional). If provided, must also specify toLineNumber.',
    ),
  toLineNumber: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Stop reading at this line number (1-based, inclusive, optional). Must be provided if fromLineNumber is specified.',
    ),
});

export const FilesReadToolSchema = z.object({
  filesToRead: z
    .array(FilesReadToolReadSchema)
    .min(1)
    .describe(
      'List of files to read. You can read multiple files in one call, each with optional line ranges.',
    ),
});

export type FilesReadToolSchemaType = z.infer<typeof FilesReadToolSchema>;

type FilesReadToolFileOutput = {
  filePath: string;
  error?: string;
  content?: string;
  lineCount?: number;
};

type FilesReadToolOutput = {
  error?: string;
  files?: FilesReadToolFileOutput[];
};

function shQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

@Injectable()
export class FilesReadTool extends FilesBaseTool<FilesReadToolSchemaType> {
  public name = 'files_read';
  public description =
    'Read file contents by absolute path (optionally with a line range).';

  protected override generateTitle(
    args: FilesReadToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const first = args.filesToRead[0]?.filePath;
    const name = first ? basename(first) : 'files';
    const range =
      args.filesToRead[0]?.fromLineNumber !== undefined &&
      args.filesToRead[0]?.toLineNumber !== undefined
        ? ` lines ${args.filesToRead[0].fromLineNumber}-${args.filesToRead[0].toLineNumber}`
        : '';
    const suffix =
      args.filesToRead.length > 1
        ? ` (+${args.filesToRead.length - 1} more)`
        : '';
    return `Reading ${name}${suffix}${range}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Read file contents by absolute path. Supports line ranges and multiple files per call.

      ### When to Use
      - View source/config before edits
      - Pull context around a search match
      - Inspect generated output or logs in a file

      ### When NOT to Use
      - Binary files -> use shell tool
      - Finding paths -> use \`files_find_paths\`
      - Searching content -> use \`files_search_text\`

      ### Best Practices
      - Read only line ranges for large files to minimize tokens.
      - Batch related reads into one call to reduce tool invocations.
      - Use file paths returned by \`files_find_paths\` to avoid path mistakes.
      - After \`files_search_text\`, read a small context window (e.g., 10-30 lines).

      ### Examples
      **1) Read a line range:**
      \`\`\`json
      {"filesToRead":[{"filePath":"/repo/src/large.ts","fromLineNumber":120,"toLineNumber":160}]}
      \`\`\`

      **2) Read multiple files at once:**
      \`\`\`json
      {"filesToRead":[{"filePath":"/repo/tsconfig.json"},{"filePath":"/repo/package.json"}]}
      \`\`\`

      **3) Batch + range:**
      \`\`\`json
      {"filesToRead":[{"filePath":"/repo/src/a.ts","fromLineNumber":10,"toLineNumber":40},{"filePath":"/repo/package.json"}]}
      \`\`\`
    `;
  }

  public get schema() {
    return FilesReadToolSchema;
  }

  protected createMarker(): string {
    return randomUUID();
  }

  public async invoke(
    args: FilesReadToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesReadToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    for (const read of args.filesToRead) {
      const hasStart = read.fromLineNumber !== undefined;
      const hasEnd = read.toLineNumber !== undefined;
      if (hasStart && !hasEnd) {
        return {
          output: {
            error: `toLineNumber must be provided when fromLineNumber is specified (file: ${read.filePath})`,
          },
          messageMetadata,
        };
      }

      if (!hasStart && hasEnd) {
        return {
          output: {
            error: `fromLineNumber must be provided when toLineNumber is specified (file: ${read.filePath})`,
          },
          messageMetadata,
        };
      }

      if (
        read.fromLineNumber !== undefined &&
        read.toLineNumber !== undefined &&
        read.fromLineNumber > read.toLineNumber
      ) {
        return {
          output: {
            error: `fromLineNumber must be less than or equal to toLineNumber (file: ${read.filePath})`,
          },
          messageMetadata,
        };
      }
    }

    const marker = this.createMarker();
    const beginPrefix = `__AI_FILES_READ_BEGIN_${marker}__`;
    const exitPrefix = `__AI_FILES_READ_EXIT_${marker}__`;
    const payloadPrefix = `__AI_FILES_READ_PAYLOAD_${marker}__`;
    const endPrefix = `__AI_FILES_READ_END_${marker}__`;

    const scriptParts: string[] = ['set +e'];
    for (let i = 0; i < args.filesToRead.length; i++) {
      const read = args.filesToRead[i];
      const filePath = read?.filePath;
      if (!filePath) continue;
      const idx = String(i);
      const cmd =
        read.fromLineNumber !== undefined && read.toLineNumber !== undefined
          ? `sed -n '${read.fromLineNumber},${read.toLineNumber}p' ${shQuote(filePath)}`
          : `cat ${shQuote(filePath)}`;
      scriptParts.push(
        `__out="$({ ${cmd}; } 2>&1)"; __ec=$?; printf "%s\\n" "${beginPrefix}${idx}"; printf "%s\\n" "${exitPrefix}${idx}:$__ec"; printf "%s\\n" "${payloadPrefix}${idx}"; printf "%s" "$__out"; printf "\\n%s\\n" "${endPrefix}${idx}"`,
      );
    }

    const res = await this.execCommand(
      {
        cmd: scriptParts.join('; '),
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      return {
        output: {
          error: res.stderr || res.stdout || 'Failed to read files',
        },
        messageMetadata,
      };
    }

    const files: FilesReadToolFileOutput[] = [];
    const stdoutLines = res.stdout.split('\n');

    for (let i = 0; i < args.filesToRead.length; i++) {
      const read = args.filesToRead[i];
      const filePath = read?.filePath;
      if (!filePath) continue;
      const idx = String(i);
      const beginLine = `${beginPrefix}${idx}`;
      const endLine = `${endPrefix}${idx}`;
      const payloadLine = `${payloadPrefix}${idx}`;
      const exitLinePrefix = `${exitPrefix}${idx}:`;

      const beginIdx = stdoutLines.indexOf(beginLine);
      if (beginIdx === -1) {
        files.push({
          filePath,
          error: 'Failed to parse tool output (missing begin marker)',
        });
        continue;
      }

      const exitLine = stdoutLines[beginIdx + 1];
      const payloadMarker = stdoutLines[beginIdx + 2];
      if (!exitLine || !exitLine.startsWith(exitLinePrefix)) {
        files.push({
          filePath,
          error: 'Failed to parse tool output (missing exit marker)',
        });
        continue;
      }
      if (payloadMarker !== payloadLine) {
        files.push({
          filePath,
          error: 'Failed to parse tool output (missing payload marker)',
        });
        continue;
      }

      const endIdx = stdoutLines.indexOf(endLine, beginIdx + 3);
      if (endIdx === -1) {
        files.push({
          filePath,
          error: 'Failed to parse tool output (missing end marker)',
        });
        continue;
      }

      const exitCodeRaw = exitLine.slice(exitLinePrefix.length).trim();
      const exitCode = Number.parseInt(exitCodeRaw || '1', 10);
      const payload = stdoutLines.slice(beginIdx + 3, endIdx).join('\n');

      if (exitCode !== 0) {
        files.push({
          filePath,
          error: payload || 'Failed to read file',
        });
        continue;
      }

      const content = payload;
      const lineCount = content.split('\n').length;
      files.push({ filePath, content, lineCount });
    }

    return {
      output: { files },
      messageMetadata,
    };
  }
}
