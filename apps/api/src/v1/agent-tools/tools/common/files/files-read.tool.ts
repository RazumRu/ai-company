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
      'Absolute path to a file. Can use paths directly from `files_find_paths` output.',
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

export const FilesReadToolSchema = z.object({
  reads: z
    .array(FilesReadToolReadSchema)
    .min(1)
    .describe(
      'Files to read. Each item can optionally specify its own line range.',
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
    const first = args.reads[0]?.filePath;
    const name = first ? basename(first) : 'files';
    const range =
      args.reads[0]?.startLine !== undefined &&
      args.reads[0]?.endLine !== undefined
        ? ` lines ${args.reads[0].startLine}-${args.reads[0].endLine}`
        : '';
    const suffix =
      args.reads.length > 1 ? ` (+${args.reads.length - 1} more)` : '';
    return `Reading ${name}${suffix}${range}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Reads file contents from the filesystem. Supports reading entire files or specific line ranges.

      ### When to Use
      Reading source code, config files (package.json, tsconfig.json), or getting file content before modifications.

      ### When NOT to Use
      For binary files → use shell tool. To locate paths → use \`files_find_paths\`. To search content across files → use \`files_search_text\`.

      ### Best Practices
      **1. Read targeted sections for large files:**
      \`\`\`json
      {"reads": [{"filePath": "/repo/large-file.ts", "startLine": 100, "endLine": 150}]}
      \`\`\`

      **2. Read multiple files at once:**
      \`\`\`json
      {"reads": [{"filePath": "/repo/tsconfig.json"}, {"filePath": "/repo/package.json"}]}
      \`\`\`

      **3. Read context around found matches:**
      After \`files_search_text\` finds match at line 150, read surrounding context:
      \`\`\`json
      {"reads": [{"filePath": "/repo/src/utils.ts", "startLine": 140, "endLine": 170}]}
      \`\`\`
    `;
  }

  public get schema() {
    return z.toJSONSchema(FilesReadToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
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

    for (const read of args.reads) {
      const hasStart = read.startLine !== undefined;
      const hasEnd = read.endLine !== undefined;
      if (hasStart && !hasEnd) {
        return {
          output: {
            error: `endLine must be provided when startLine is specified (file: ${read.filePath})`,
          },
          messageMetadata,
        };
      }

      if (!hasStart && hasEnd) {
        return {
          output: {
            error: `startLine must be provided when endLine is specified (file: ${read.filePath})`,
          },
          messageMetadata,
        };
      }

      if (
        read.startLine !== undefined &&
        read.endLine !== undefined &&
        read.startLine > read.endLine
      ) {
        return {
          output: {
            error: `startLine must be less than or equal to endLine (file: ${read.filePath})`,
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
    for (let i = 0; i < args.reads.length; i++) {
      const read = args.reads[i];
      const filePath = read?.filePath;
      if (!filePath) continue;
      const idx = String(i);
      const cmd =
        read.startLine !== undefined && read.endLine !== undefined
          ? `sed -n '${read.startLine},${read.endLine}p' ${shQuote(filePath)}`
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

    for (let i = 0; i < args.reads.length; i++) {
      const read = args.reads[i];
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
