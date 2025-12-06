import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { ExtendedLangGraphRunnableConfig } from '../../base-tool';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

export const FilesListToolSchema = z.object({
  dir: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Directory path to search. If omitted, uses the current working directory of the persistent shell session.',
    ),
  pattern: z
    .string()
    .optional()
    .describe(
      'Glob pattern to filter files. Uses fd glob syntax. (e.g., "*.ts", "src/**", "*.test.ts", "package.json").',
    ),
});

export type FilesListToolSchemaType = z.infer<typeof FilesListToolSchema>;

type FilesListToolOutput = {
  error?: string;
  files?: string[];
};

@Injectable()
export class FilesListTool extends FilesBaseTool<FilesListToolSchemaType> {
  public name = 'files_list';
  public description =
    'List files in a repository directory using fd (find). Supports optional pattern filtering. Returns an array of absolute file paths. The paths returned can be used directly with files_read, files_apply_changes, and files_search_text.filePath.';

  public getDetailedInstructions(
    config: FilesBaseToolConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Lists files in a directory using the \`fd\` command (a fast alternative to \`find\`). Returns absolute paths that can be directly used with other file tools. When \`dir\` is omitted, the command runs in the current working directory of the persistent shell session (so you can \`cd\` once via the shell tool and then list without repeating the path).

      ### When to Use
      - Exploring a new codebase to understand its structure
      - Finding files by extension or name pattern
      - Getting a list of files to process iteratively
      - Verifying a file exists before reading or modifying

      ### When NOT to Use
      - When searching for content inside files → use \`files_search_text\`
      - When you know the exact file path already → go directly to \`files_read\`
      - For complex directory tree visualization → use shell with \`tree\` command

      ${parameterDocs}

      ### Best Practices

      **1. Start broad, then narrow (with or without dir):**
      \`\`\`json
        // First, understand the structure
        {"dir": "/repo"}

        // Then focus on specific areas
        {"dir": "/repo/src", "pattern": "*.ts"}

        // If you already cd'd into /repo/src with shell, dir can be omitted
        {"pattern": "*.ts"}

        // From current directory (after shell cd): list everything
        {"pattern": "**/*.ts"}
      \`\`\`

      **2. Use specific patterns to reduce output:**
      \`\`\`json
        // Good: Specific pattern
        {"dir": "/repo", "pattern": "*.config.js"}

        // Avoid: Too broad on large repos
        {"dir": "/repo"}  // Could return thousands of files
      \`\`\`

      **3. Common pattern examples:**
      | Pattern | Matches |
      |---------|---------|
      | \`*.ts\` | All TypeScript files |
      | \`*.{ts,tsx}\` | TypeScript and TSX files |
      | \`*.test.*\` | All test files |
      | \`**/components/**\` | All files in any components directory |
      | \`!*.spec.ts\` | Exclude spec files (fd syntax) |

      ### Output Format
      \`\`\`json
        {
          "files": [
            "/repo/src/index.ts",
            "/repo/src/app.ts",
            "/repo/src/utils/helpers.ts"
          ]
        }
      \`\`\`

      Or on error:
      \`\`\`json
        {
          "error": "directory not found"
        }
      \`\`\`

      ### Common Patterns

      **Explore project structure:**
      1. List root directory to see top-level organization
      2. List specific directories (src, lib, tests) to understand code layout
      3. Filter by extension to focus on relevant file types

      **Find configuration files:**
      \`\`\`json
        {"dir": "/repo", "pattern": "*.config.*"}
        {"dir": "/repo", "pattern": "*rc.json"}
        {"dir": "/repo", "pattern": "*.json"}
      \`\`\`

      **Find test files:**
      \`\`\`json
        {"dir": "/repo", "pattern": "*.test.ts"}
        {"dir": "/repo", "pattern": "*.spec.ts"}
        {"dir": "/repo", "pattern": "**/__tests__/**"}
      \`\`\`

      ### Integration with Other Tools
      The paths returned are absolute and can be directly used with:
      - \`files_read\`: Read file content
      - \`files_apply_changes\`: Modify files
      - \`files_search_text\`: Search within specific files
    `;
  }

  public get schema() {
    return FilesListToolSchema;
  }

  public async invoke(
    args: FilesListToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<FilesListToolOutput> {
    const cmdParts: string[] = ['fd', '--absolute-path'];

    if (args.pattern) {
      cmdParts.push('--glob', `"${args.pattern}"`);
    }

    cmdParts.push('--type', 'f', '--hidden', '--exclude', '.git');

    const baseCmd = cmdParts.join(' ');
    const cmd = args.dir ? `cd "${args.dir}" && ${baseCmd}` : baseCmd;

    const res = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      return {
        error: res.stderr || res.stdout || 'Failed to list files',
      };
    }

    // Split stdout by newlines and filter out empty strings
    const files = res.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return {
      files,
    };
  }
}
