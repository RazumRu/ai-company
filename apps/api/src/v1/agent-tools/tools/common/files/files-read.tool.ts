import { createHash, randomUUID } from 'node:crypto';
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

const FilesReadToolReadSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe(
      'Absolute path to the file to read (must start with /runtime-workspace/). Use paths directly from codebase_search or files_find_paths output.',
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
  fileSizeBytes?: number;
  startLine?: number;
  contentHash?: string;
};

type FilesReadToolOutput = {
  error?: string;
  files?: FilesReadToolFileOutput[];
};

@Injectable()
export class FilesReadTool extends FilesBaseTool<FilesReadToolSchemaType> {
  public name = 'files_read';
  public description =
    'Read one or more files and return their contents with line numbers. Supports batching multiple files in a single call and optional line ranges for large files. All file paths must be absolute. Always read a file before editing it.';

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
      Read file contents with line numbers (\`NNN\\tcode\` format). Supports batching multiple files and line ranges.

      ### Path Requirements
      - ALL paths MUST be absolute (start with /runtime-workspace/)
      - Use absolute paths from \`codebase_search\` output or \`files_find_paths\` (codebase_search paths are already absolute — no need to call files_find_paths first)

      ### Reading Strategy
      - **Batch multiple files into ONE call** — reading 5 files in one call is much better than 5 separate calls
      - Default to reading **entire files** unless very large (>300 lines)
      - Use line ranges only for large files: \`fromLineNumber\`/\`toLineNumber\`
      - Never re-read a file you already have in context

      ### Output Format
      Each line is prefixed with its line number and a tab: \`42\\tconst x = 1;\`
      Line numbers are for reference only. Do NOT include the \`NNN\\t\` prefix when copying text to \`oldText\` in edit tools.

      ### Content Hash
      Each file response includes a \`contentHash\` — pass it to \`files_apply_changes\` as \`expectedHash\` to detect stale reads (file changed since you read it).

      ### Example — batch read:
      \`\`\`json
      {"filesToRead":[
        {"filePath":"/runtime-workspace/project/src/service.ts"},
        {"filePath":"/runtime-workspace/project/src/dao.ts"},
        {"filePath":"/runtime-workspace/project/src/large.ts","fromLineNumber":1,"toLineNumber":300}
      ]}
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
      // Early validation for path mistakes
      if (!read.filePath.startsWith('/')) {
        return {
          output: {
            error: dedent`
              Invalid path: "${read.filePath}" is a relative path.

              All paths must be absolute and start with /runtime-workspace/.

              TIP: Use paths exactly as returned by codebase_search or files_find_paths.
              Example: /runtime-workspace/my-project/${read.filePath}
            `,
          },
          messageMetadata,
        };
      }

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
      // Also get file size using wc -c
      const sizeCmd = `wc -c < ${shQuote(filePath)} 2>/dev/null || echo "0"`;
      scriptParts.push(
        `__out="$({ ${cmd}; } 2>&1)"; __ec=$?; __size=$(${sizeCmd}); printf "%s\\n" "${beginPrefix}${idx}"; printf "%s\\n" "${exitPrefix}${idx}:$__ec"; printf "%s\\n" "__SIZE__:$__size"; printf "%s\\n" "${payloadPrefix}${idx}"; printf "%s" "$__out"; printf "\\n%s\\n" "${endPrefix}${idx}"`,
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
      const sizeLine = stdoutLines[beginIdx + 2];
      const payloadMarker = stdoutLines[beginIdx + 3];
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

      const endIdx = stdoutLines.indexOf(endLine, beginIdx + 4);
      if (endIdx === -1) {
        files.push({
          filePath,
          error: 'Failed to parse tool output (missing end marker)',
        });
        continue;
      }

      const exitCodeRaw = exitLine.slice(exitLinePrefix.length).trim();
      const exitCode = Number.parseInt(exitCodeRaw || '1', 10);

      // Parse file size
      const fileSizeBytes = sizeLine?.startsWith('__SIZE__:')
        ? Number.parseInt(sizeLine.slice('__SIZE__:'.length).trim() || '0', 10)
        : undefined;

      const payload = stdoutLines.slice(beginIdx + 4, endIdx).join('\n');

      if (exitCode !== 0) {
        files.push({
          filePath,
          error: payload || 'Failed to read file',
        });
        continue;
      }

      const rawContent = payload;
      const startLineOffset = read.fromLineNumber ?? 1;
      const lines = rawContent.split('\n');
      const lineCount = lines.length;
      const content = lines
        .map((line, i) => `${i + startLineOffset}\t${line}`)
        .join('\n');
      const contentHash = createHash('sha256')
        .update(rawContent)
        .digest('hex')
        .slice(0, 8);
      files.push({
        filePath,
        content,
        lineCount,
        fileSizeBytes,
        startLine: startLineOffset,
        contentHash,
      });
    }

    return {
      output: { files },
      messageMetadata,
    };
  }
}
