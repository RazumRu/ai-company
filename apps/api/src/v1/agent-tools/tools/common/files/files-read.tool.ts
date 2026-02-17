import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { environment } from '../../../../../environments';
import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BASE_RUNTIME_WORKDIR } from '../../../../runtime/services/base-runtime';
import { shQuote } from '../../../../utils/shell.utils';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

const TRUNCATE_HEAD_LINES = 50;
const TRUNCATE_TAIL_LINES = 50;

const FilesReadToolReadSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe(
      'Absolute path to the file to read. Use paths directly from codebase_search or files_find_paths output.',
    ),
  fromLineNumber: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      'Start reading from this line number (1-based, optional). If provided, must also specify toLineNumber.',
    ),
  toLineNumber: z
    .number()
    .int()
    .positive()
    .nullable()
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
  warning?: string;
};

type FilesReadToolOutput = {
  error?: string;
  files?: FilesReadToolFileOutput[];
};

@Injectable()
export class FilesReadTool extends FilesBaseTool<FilesReadToolSchemaType> {
  public name = 'files_read';
  public description =
    'Read one or more files and return their contents with line numbers. Supports batching multiple files in a single call and optional line ranges. ⚠️ For large files (>300 lines), you MUST use fromLineNumber/toLineNumber to read only the relevant section — NEVER fetch full content of files with more than 300 lines. Use total_lines from codebase_search or lineCount from previous reads to check file size before reading. All file paths must be absolute. Always read a file before editing it. This is a read-only tool — to modify files use files_apply_changes, to create new files use files_write_file.';

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
      - ALL paths MUST be absolute
      - Use absolute paths from \`codebase_search\` output (already absolute — no need to call \`files_find_paths\` first)

      ### ⚠️ CRITICAL — Reading Strategy (NEVER skip this)
      Before reading any file, you MUST know its size. Use \`total_lines\` from \`codebase_search\` results or \`lineCount\` from previous reads.

      - **Batch multiple files into ONE call** — reading 5 files in one call is much better than 5 separate calls
      - **Small files (≤300 lines)**: read the entire file (no line range needed)
      - **Large files (>300 lines)**: you MUST use \`fromLineNumber\`/\`toLineNumber\`. NEVER omit line ranges for files over 300 lines. Use \`start_line\`/\`end_line\` from \`codebase_search\` ± 30 lines of padding to target the relevant section.
      - **If you don't know the file size**: use \`codebase_search\` first to get \`total_lines\`, or read a small range (e.g., lines 1-100) to check the file size via \`lineCount\` in the response.
      - Never re-read a file you already have in context

      **WRONG**: Reading a 1000-line file without line ranges → wastes context, degrades analysis
      **RIGHT**: Reading lines 150-250 of a 1000-line file based on codebase_search results

      ### Output Format
      Each line is prefixed with its line number and a tab: \`42\\tconst x = 1;\`
      Line numbers are for reference only. Do NOT include the \`NNN\\t\` prefix when copying text to \`oldText\` in edit tools.

      The response includes \`lineCount\` (total lines returned) and \`fileSizeBytes\` for each file.

      ### Example — batch read with line ranges for large files:
      \`\`\`json
      {"filesToRead":[
        {"filePath":"${BASE_RUNTIME_WORKDIR}/project/src/service.ts"},
        {"filePath":"${BASE_RUNTIME_WORKDIR}/project/src/dao.ts"},
        {"filePath":"${BASE_RUNTIME_WORKDIR}/project/src/large.ts","fromLineNumber":100,"toLineNumber":250}
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

              All paths must be absolute and start with ${BASE_RUNTIME_WORKDIR}/.

              TIP: Use paths exactly as returned by codebase_search or files_find_paths.
              Example: ${BASE_RUNTIME_WORKDIR}/my-project/${read.filePath}
            `,
          },
          messageMetadata,
        };
      }

      const hasStart = read.fromLineNumber != null;
      const hasEnd = read.toLineNumber != null;
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
        read.fromLineNumber != null &&
        read.toLineNumber != null &&
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

      const noLineRange = read.fromLineNumber === undefined;
      const maxLines = environment.filesReadMaxLines;

      if (noLineRange && lineCount > maxLines) {
        const headLines = lines.slice(0, TRUNCATE_HEAD_LINES);
        const tailLines = lines.slice(-TRUNCATE_TAIL_LINES);

        const headContent = headLines
          .map((line, idx) => `${idx + 1}\t${line}`)
          .join('\n');
        const tailStartLine = lineCount - TRUNCATE_TAIL_LINES + 1;
        const tailContent = tailLines
          .map((line, idx) => `${idx + tailStartLine}\t${line}`)
          .join('\n');

        const truncatedWarning = `\n\n... [TRUNCATED: File has ${lineCount} total lines but the maximum is ${maxLines} without line ranges. Showing first ${TRUNCATE_HEAD_LINES} and last ${TRUNCATE_TAIL_LINES} lines. Use fromLineNumber/toLineNumber to read specific sections.] ...\n\n`;

        files.push({
          filePath,
          content: headContent + truncatedWarning + tailContent,
          lineCount,
          fileSizeBytes,
          startLine: 1,
          warning: `File has ${lineCount} lines (limit: ${maxLines}). Content was truncated. Use fromLineNumber/toLineNumber to read specific sections.`,
        });
        continue;
      }

      const content = lines
        .map((line, idx) => `${idx + startLineOffset}\t${line}`)
        .join('\n');
      files.push({
        filePath,
        content,
        lineCount,
        fileSizeBytes,
        startLine: startLineOffset,
      });
    }

    return {
      output: { files },
      messageMetadata,
    };
  }
}
