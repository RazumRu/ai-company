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

export const FilesBuildTagsToolSchema = z.object({
  dir: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Directory path to index. If omitted, uses the current working directory of the persistent shell session. Use absolute paths when provided.',
    ),
  alias: z.string().min(1).describe('Alias/name for the tags index file.'),
});

export type FilesBuildTagsToolSchemaType = z.infer<
  typeof FilesBuildTagsToolSchema
>;

type FilesBuildTagsToolOutput = {
  error?: string;
  success?: boolean;
  tagsFile?: string;
};

@Injectable()
export class FilesBuildTagsTool extends FilesBaseTool<FilesBuildTagsToolSchemaType> {
  public name = 'files_build_tags';
  public description =
    'Build a ctags index for a repository directory. Creates a JSON-formatted tags file that can be used for symbol searching. Takes a directory path and an alias to name the tags file. This tool needs to be called when the repository is initialized and when files are changed to keep the index up to date.';

  protected override generateTitle(
    args: FilesBuildTagsToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const dir = args.dir ?? 'current directory';
    return `Building tags "${args.alias}" in ${dir}`;
  }

  public getDetailedInstructions(
    config: FilesBaseToolConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Generates a ctags index file for a codebase, enabling fast symbol-based searches. The index includes functions, classes, methods, variables, and other language constructs. This is a prerequisite for using \`files_search_tags\`. If \`dir\` is omitted, indexing runs in the current working directory of the persistent shell session (e.g., after \`cd\` via shell).

      ### When to Use
      - At the start of working with a new repository (one-time setup)
      - After making significant changes to the codebase structure
      - Before using \`files_search_tags\` to search for symbols
      - When you need to navigate a large codebase efficiently

      ### When NOT to Use
      - For simple text search → use \`files_search_text\`
      - When the index is already built and files haven't changed
      - For small projects where text search is sufficient

      ${parameterDocs}

      ### Best Practices

      **1. Build once per repository:**
      \`\`\`json
        // At the start of your session
        {"dir": "/repo", "alias": "project"}

        // Already cd /repo via shell: omit dir
        {"alias": "project"}
      \`\`\`

      **2. Use meaningful aliases:**
      \`\`\`json
        // Good: Descriptive
        {"dir": "/repo/apps/api", "alias": "api-service"}

        // Avoid: Generic
        {"dir": "/repo/apps/api", "alias": "tags"}
      \`\`\`

      **3. Rebuild after major changes:**
      If you've added new files or restructured the codebase, rebuild:
      \`\`\`json
        {"dir": "/repo", "alias": "project"}  // Same alias overwrites old index
      \`\`\`

      ### Output Format
      Success:
      \`\`\`json
        {
          "success": true,
          "tagsFile": "/tmp/thread-id/project.json"
        }
      \`\`\`

      Error:
      \`\`\`json
        {
          "error": "ctags: command not found"
        }
      \`\`\`

      ### Supported Languages
      Ctags supports 40+ languages including:
      - JavaScript/TypeScript
      - Python
      - Java
      - Go
      - Rust
      - C/C++
      - Ruby
      - PHP
      - And many more

      ### After Building
      Use \`files_search_tags\` to search the index:
      \`\`\`json
        {"dir": "/repo", "alias": "project", "query": "handleSubmit", "exactMatch": true}
      \`\`\`

      ### Performance Notes
      - Indexing is fast (typically seconds for medium projects)
      - Index is stored in temp directory (persistent within session)
      - Larger projects may take longer to index
      - Re-running with same alias updates the existing index
    `;
  }

  public get schema() {
    return FilesBuildTagsToolSchema;
  }

  public async invoke(
    args: FilesBuildTagsToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<FilesBuildTagsToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };
    const threadId =
      cfg.configurable?.parent_thread_id ||
      cfg.configurable?.thread_id ||
      'unknown';

    // Create the tags directory if it doesn't exist
    const tagsDir = `/tmp/${threadId.replace(/:/g, '_')}`;
    const tagsFile = `${tagsDir}/${args.alias}.json`;

    // First, ensure the directory exists
    const mkdirCmd = `mkdir -p "${tagsDir}"`;
    const mkdirRes = await this.execCommand(
      {
        cmd: mkdirCmd,
      },
      config,
      cfg,
    );

    if (mkdirRes.exitCode !== 0) {
      return {
        output: {
          error: `Failed to create tags directory: ${mkdirRes.stderr || mkdirRes.stdout}`,
        },
        messageMetadata,
      };
    }

    // Build ctags index without mutating session cwd (use subshell)
    const baseCmd = `ctags -R --fields=+n+K --extras=+q --output-format=json -f "${tagsFile}" .`;
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
        output: {
          error: res.stderr || res.stdout || 'Failed to build tags',
        },
        messageMetadata,
      };
    }

    return {
      output: {
        success: true,
        tagsFile,
      },
      messageMetadata,
    };
  }
}
