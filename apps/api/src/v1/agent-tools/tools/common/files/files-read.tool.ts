import { randomUUID } from 'node:crypto';
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
  fileSizeBytes?: number;
};

type FilesReadToolOutput = {
  error?: string;
  files?: FilesReadToolFileOutput[];
};

@Injectable()
export class FilesReadTool extends FilesBaseTool<FilesReadToolSchemaType> {
  public name = 'files_read';
  public description =
    'Read file contents by absolute path. ALWAYS batch multiple files into ONE call to minimize tool invocations.';

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
      **CRITICAL: ALWAYS batch multiple files into ONE call instead of making separate calls for each file.**

      ### CRITICAL: Path Requirements
      - ALL paths MUST be absolute (start with /runtime-workspace/)
      - NEVER use relative paths like "apps/api/src/..."
      - Use paths exactly as returned by \`files_find_paths\` or \`codebase_search\`

      ### Correct Path Examples
      ✅ /runtime-workspace/my-project/src/index.ts
      ✅ /runtime-workspace/ai-company/apps/api/src/main.ts
      ❌ apps/api/src/main.ts (WRONG - relative path)
      ❌ src/index.ts (WRONG - relative path)

      ### When to Use
      - View source/config before edits
      - Pull context around a search match
      - Inspect generated output or logs in a file

      ### When NOT to Use
      - Binary files -> use shell tool
      - Finding paths -> use \`files_find_paths\`
      - Searching content -> use \`files_search_text\`

      ### CRITICAL: Reading Strategy to Minimize Tool Calls
      **ALWAYS batch multiple files into ONE tool call. NEVER make separate calls for each file.**
      - Reading 5 files in one call is MUCH better than 5 separate calls
      - Default to reading ENTIRE files unless they are very large (>300 lines)
      - Reading the whole file once is cheaper than multiple small reads
      - Line ranges are for LARGE files only (>300 lines)
      - If you need multiple sections of the same file, read it ONCE without line ranges
      - After initial read, you have the full context - don't re-read the same file

      **Examples of CORRECT usage:**
      ✅ Read multiple files in ONE call: {"filesToRead":[{"filePath":"/path/to/service.ts"},{"filePath":"/path/to/dao.ts"},{"filePath":"/path/to/controller.ts"}]}
      ✅ Read entire file: {"filesToRead":[{"filePath":"/path/to/service.ts"}]}
      ✅ Large file chunks: {"filesToRead":[{"filePath":"/path/to/large.ts","fromLineNumber":1,"toLineNumber":300}]}
      ❌ WRONG - separate calls: files_read service.ts, then files_read dao.ts, then files_read controller.ts (wasteful!)
      ❌ WRONG - multiple small reads: files_read lines 1-30, then 101-300, then 250-350 (wasteful!)
      ✅ CORRECT - one batched read: files_read all 3 files in one call

      ### Best Practices
      - **ALWAYS batch multiple files into ONE call** - this is the #1 optimization
      - **Default to reading entire files** - only use line ranges for files >300 lines
      - Plan ahead: if you'll need service.ts, dao.ts, and controller.ts, read all THREE in one call
      - Never re-read a file you've already read in the same conversation
      - Use file paths returned by \`files_find_paths\` to avoid path mistakes
      - After \`files_search_text\`, read all matching files in one batched call

      ### Examples
      **1) Read multiple files in ONE call (PREFERRED - always batch!):**
      \`\`\`json
      {"filesToRead":[
        {"filePath":"/runtime-workspace/project/src/service.ts"},
        {"filePath":"/runtime-workspace/project/src/dao.ts"},
        {"filePath":"/runtime-workspace/project/src/controller.ts"},
        {"filePath":"/runtime-workspace/project/tsconfig.json"}
      ]}
      \`\`\`

      **2) Read single entire file (when you truly only need one file):**
      \`\`\`json
      {"filesToRead":[{"filePath":"/runtime-workspace/project/src/service.ts"}]}
      \`\`\`

      **3) Large file with line range (only when file is >300 lines):**
      \`\`\`json
      {"filesToRead":[{"filePath":"/runtime-workspace/project/src/large.ts","fromLineNumber":1,"toLineNumber":300}]}
      \`\`\`

      **4) Mix of full files and large file ranges in ONE call:**
      \`\`\`json
      {"filesToRead":[
        {"filePath":"/runtime-workspace/project/src/small.ts"},
        {"filePath":"/runtime-workspace/project/src/large.ts","fromLineNumber":1,"toLineNumber":300},
        {"filePath":"/runtime-workspace/project/package.json"}
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

      const content = payload;
      const lineCount = content.split('\n').length;
      files.push({ filePath, content, lineCount, fileSizeBytes });
    }

    return {
      output: { files },
      messageMetadata,
    };
  }
}
