import { Buffer } from 'node:buffer';
import { dirname } from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { ExtendedLangGraphRunnableConfig } from '../../base-tool';
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
    'Apply changes to a file using an absolute path. Supports replacing entire file, replacing line ranges, inserting content at specific lines, and deleting line ranges. The filePath parameter expects an absolute path (can be used directly with paths returned from files_list). Returns success status and updated line count.';

  public get schema() {
    return FilesApplyChangesToolSchema;
  }

  public getDetailedInstructions(
    config: FilesBaseToolConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Applies modifications to files with surgical precision. Supports four operations: full replacement, line range replacement, insertion, and deletion. All operations are atomic - they either fully succeed or fail without partial changes.

      ### When to Use
      - Creating new files (operation: "replace" on non-existent file)
      - Modifying specific lines in source code
      - Adding imports or new code sections
      - Removing deprecated code blocks
      - Any file modification where you need precise control

      ### When NOT to Use
      - For bulk find-and-replace across multiple files → use shell with \`sed\` or custom script
      - For reading files → use \`files_read\`
      - For simple appending → can use shell with \`echo >> file\`

      ### Operations

      #### 1. \`replace\` - Replace Entire File
      Replaces all content. Creates file if it doesn't exist.

      Example:
      \`\`\`json
      {
        "filePath": "/repo/src/new-file.ts",
        "operation": "replace",
        "content": "export const hello = 'world';"
      }
      \`\`\`

      **Use for:**
      - Creating new files
      - Complete file rewrites
      - Small files where full replacement is simpler

      #### 2. \`replace_range\` - Replace Specific Lines
      Replaces lines from startLine to endLine (inclusive) with new content.

      Example:
      \`\`\`json
      {
        "filePath": "/repo/src/app.ts",
        "operation": "replace_range",
        "startLine": 10,
        "endLine": 15,
        "content": "// New implementationfunction updated() {  return 'new';}"
      }
      \`\`\`

      **Use for:**
      - Updating function implementations
      - Modifying code blocks
      - Fixing bugs in specific sections

      **Important:** Content should include appropriate newlines. The number of lines in content doesn't need to match the replaced range.

      #### 3. \`insert\` - Insert Content at Line
      Inserts new content BEFORE the specified startLine.

      Example:
      \`\`\`json
      {
        "filePath": "/repo/src/app.ts",
        "operation": "insert",
        "startLine": 1,
        "content": "import { newDep } from 'new-package';"
      }
      \`\`\`

      **Use for:**
      - Adding imports at the top of files
      - Inserting new functions or classes
      - Adding comments or documentation

      **Line numbers:**
      - startLine: 1 → Inserts at the very beginning
      - startLine: N → Inserts before line N (line N becomes line N + newLines)

      #### 4. \`delete\` - Remove Lines
      Removes lines from startLine to endLine (inclusive).

      Example:
      \`\`\`json
      {
        "filePath": "/repo/src/app.ts",
        "operation": "delete",
        "startLine": 20,
        "endLine": 25
      }
      \`\`\`

      **Use for:**
      - Removing deprecated code
      - Cleaning up unused imports
      - Removing debug statements

      ${parameterDocs}

      ### Best Practices

      **1. Always read before modifying:**
      1. files_read the file to see current content and line numbers
      2. Identify exact lines to modify
      3. files_apply_changes with precise line numbers
      4. Optionally files_read again to verify

      **2. Keep content format correct:**
      - Include trailing newlines where appropriate
      - Match the file's existing indentation style
      - Preserve line endings (usually )

      **3. Make minimal changes:**
      Instead of replacing 100 lines, replace just the 5 lines that need changing.

      **4. For new files, use replace:**
      \`\`\`json
      {
        "filePath": "/repo/src/newFile.ts",
        "operation": "replace",
        "content": "// New file content"
      }
      \`\`\`

      ### Output Format
      Success:
      \`\`\`json
      {
        "success": true,
        "lineCount": 150
      }
      \`\`\`

      Error:
      \`\`\`json
      {
        "success": false,
        "error": "startLine must be less than or equal to endLine"
      }
      \`\`\`

      ### Common Patterns

      **Adding an import:**
      \`\`\`json
      {
        "filePath": "/repo/src/app.ts",
        "operation": "insert",
        "startLine": 1,
        "content": "import { Something } from './something';"
      }
      \`\`\`

      **Updating a function:**
      First read lines 50-70, then:
      \`\`\`json
      {
        "filePath": "/repo/src/utils.ts",
        "operation": "replace_range",
        "startLine": 50,
        "endLine": 70,
        "content": "function improvedFunction() {  // new implementation}"
      }
      \`\`\`

      **Creating a new file:**
      \`\`\`json
      {
        "filePath": "/repo/src/components/NewComponent.tsx",
        "operation": "replace",
        "content": "import React from 'react';export const NewComponent = () => {  return <div>Hello</div>;};"
      }
      \`\`\`

      ### Error Handling
      - Check that startLine <= endLine
      - Verify the file exists for replace_range, insert, delete
      - Ensure content is provided for operations that require it
      - Use files_read to verify line numbers before modifying
    `;
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
    const parentDir = dirname(fullFilePath);
    let cmd: string;

    const contentBase64 =
      args.content !== undefined
        ? Buffer.from(args.content, 'utf8').toString('base64')
        : '';

    switch (args.operation) {
      case 'replace': {
        const tempFile = `${fullFilePath}.tmp.${Date.now()}`;
        cmd = `mkdir -p "${parentDir}" && echo '${contentBase64}' | base64 -d > "${tempFile}" && mv "${tempFile}" "${fullFilePath}"`;
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

    const response = {
      success: true,
      lineCount,
    };

    return response;
  }
}
