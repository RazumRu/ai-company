import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { ExtendedLangGraphRunnableConfig } from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

export const FilesReadToolSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe(
      'Absolute path to the file. Can use paths directly from `files_list` output.',
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
    'Read the contents of a file using an absolute path. Optionally read specific line ranges using startLine and endLine parameters. The filePath parameter expects an absolute path (can be used directly with paths returned from files_list). Returns the file content and line count.';

  public getDetailedInstructions(
    config: FilesBaseToolConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
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
        {"filePath": "/repo/large-file.ts", "startLine": 0, "endLine": 500}
      \`\`\`

      **2. Read context around found matches:**
      After \`files_search_text\` finds a match at line 150:
      \`\`\`json
        {"filePath": "/repo/src/utils.ts", "startLine": 140, "endLine": 170}
      \`\`\`

      **3. Read configuration files completely:**
      Config files are usually small and need full context:
      \`\`\`json
        {"filePath": "/repo/tsconfig.json"}
      \`\`\`

      ### Output Format
      \`\`\`json
        {
          "content": "file content here...",
          "lineCount": 150
        }
      \`\`\`

      Or on error:
      \`\`\`json
        {
          "error": "cat: /path/to/file: No such file or directory"
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

    const fullFilePath = `${args.filePath}`;

    let cmd: string;
    if (args.startLine !== undefined && args.endLine !== undefined) {
      // Use sed to read specific line range
      cmd = `sed -n '${args.startLine},${args.endLine}p' "${fullFilePath}"`;
    } else {
      // Use cat to read entire file
      cmd = `cat "${fullFilePath}"`;
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
