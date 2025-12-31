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

export const FilesReadToolSchema = z.object({
  filePaths: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      'Absolute paths to files. Can use paths directly from `files_list` output.',
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
    'Read the contents of multiple files using absolute paths. Optionally read specific line ranges using startLine and endLine parameters (applied to all files). The filePaths parameter expects absolute paths (can be used directly with paths returned from files_list). Returns per-file content and line counts.';

  protected override generateTitle(
    args: FilesReadToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const first = args.filePaths[0];
    const name = first ? basename(first) : 'files';
    const range =
      args.startLine !== undefined && args.endLine !== undefined
        ? ` lines ${args.startLine}-${args.endLine}`
        : '';
    const suffix =
      args.filePaths.length > 1 ? ` (+${args.filePaths.length - 1} more)` : '';
    return `Reading ${name}${suffix}${range}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Reads file contents from the filesystem. Supports reading entire files or specific line ranges. Returns structured output with content and metadata.

      ### When to Use
      - Reading source code files to understand implementation
      - Examining configuration files (package.json, tsconfig.json, etc.)
      - Reviewing specific sections of large files
      - Getting file content before making modifications
      - Reading documentation or README files

      ### When NOT to Use
      - For binary files (images, compiled code) → use shell tool with appropriate commands
      - When you just need to check if a file exists → use \`files_list\` with the file path
      - When searching for content across many files → use \`files_search_text\` first

      ${parameterDocs}

      ### Best Practices

      **1. Read targeted sections for large files:**
      Instead of reading a 5000-line file:
      \`\`\`json
        // First, find the relevant section using files_search_text
        // Then read just that section
        {"filePaths": ["/repo/large-file.ts"], "startLine": 1, "endLine": 500}
      \`\`\`

      **2. Read context around found matches:**
      After \`files_search_text\` finds a match at line 150:
      \`\`\`json
        {"filePaths": ["/repo/src/utils.ts"], "startLine": 140, "endLine": 170}
      \`\`\`

      **3. Read configuration files completely:**
      Config files are usually small and need full context:
      \`\`\`json
        {"filePaths": ["/repo/tsconfig.json", "/repo/package.json"]}
      \`\`\`

      ### Output Format
      \`\`\`json
        {
          "files": [
            { "filePath": "/repo/tsconfig.json", "content": "file content here...", "lineCount": 150 },
            { "filePath": "/repo/package.json", "content": "file content here...", "lineCount": 42 }
          ]
        }
      \`\`\`

      Or on error:
      \`\`\`json
        {
          "files": [
            { "filePath": "/path/to/file", "error": "cat: /path/to/file: No such file or directory" }
          ]
        }
      \`\`\`

      ### Common Patterns

      **Reading before editing:**
      1. Read the file to understand current content
      2. Identify the exact lines to modify
      3. Use \`files_apply_changes\` with precise line numbers

      **Exploring a codebase:**
      1. Use \`files_list\` to discover files
      2. Use \`files_search_text\` to find relevant sections
      3. Use \`files_read\` with line ranges to examine specific parts

      ### Error Handling
      - File not found: Check the path is correct, use \`files_list\` to verify
      - Permission denied: File may be in a protected location
      - Line range errors: Ensure startLine <= endLine and both are positive
    `;
  }

  public get schema() {
    return z.toJSONSchema(FilesReadToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    }) as ReturnType<typeof z.toJSONSchema>;
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
    // Validate that if startLine is provided, endLine must also be provided
    if (args.startLine !== undefined && args.endLine === undefined) {
      return {
        output: {
          error: 'endLine must be provided when startLine is specified',
        },
        messageMetadata,
      };
    }

    if (args.endLine !== undefined && args.startLine === undefined) {
      return {
        output: {
          error: 'startLine must be provided when endLine is specified',
        },
        messageMetadata,
      };
    }

    if (
      args.startLine !== undefined &&
      args.endLine !== undefined &&
      args.startLine > args.endLine
    ) {
      return {
        output: {
          error: 'startLine must be less than or equal to endLine',
        },
        messageMetadata,
      };
    }

    const marker = this.createMarker();
    const beginPrefix = `__AI_FILES_READ_BEGIN_${marker}__`;
    const exitPrefix = `__AI_FILES_READ_EXIT_${marker}__`;
    const payloadPrefix = `__AI_FILES_READ_PAYLOAD_${marker}__`;
    const endPrefix = `__AI_FILES_READ_END_${marker}__`;

    const readCmd =
      args.startLine !== undefined && args.endLine !== undefined
        ? (filePath: string) =>
            `sed -n '${args.startLine},${args.endLine}p' ${shQuote(filePath)}`
        : (filePath: string) => `cat ${shQuote(filePath)}`;

    const scriptParts: string[] = ['set +e'];
    for (let i = 0; i < args.filePaths.length; i++) {
      const filePath = args.filePaths[i];
      if (!filePath) continue;
      const idx = String(i);
      const cmd = readCmd(filePath);
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

    for (let i = 0; i < args.filePaths.length; i++) {
      const filePath = args.filePaths[i];
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
