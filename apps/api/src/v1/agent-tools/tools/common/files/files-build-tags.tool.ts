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
  directoryPath: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Directory path to index. If omitted, uses the current working directory of the persistent shell session. Use absolute paths when provided.',
    ),
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
  public description = 'Build a ctags index (JSON) for fast symbol search.';

  protected override generateTitle(
    args: FilesBuildTagsToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const dir = args.directoryPath ?? 'current directory';
    return `Building tags in ${dir}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Build a ctags index (JSON) for fast symbol lookup with \`files_search_tags\`.

      ### When to Use
      - Large repos where symbol search is frequent
      - Fast "jump to definition" workflows
      - You plan to call \`files_search_tags\` multiple times

      ### When NOT to Use
      - You only need text search -> \`files_search_text\`

      ### Best Practices
      - Build once per repo/session, rebuild after file changes.
      - If you already cd into the repo, omit directoryPath.
      - Rebuild after renames or large refactors.

      ### Examples
      **1) Build tags for a repo:**
      \`\`\`json
      {"directoryPath":"/repo"}
      \`\`\`

      **2) Build in current directory (after cd):**
      \`\`\`json
      {}
      \`\`\`
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
      cfg.configurable?.parent_thread_id || cfg.configurable?.thread_id;
    if (!threadId) {
      return {
        output: {
          error: 'Thread id is required to build tags',
        },
        messageMetadata,
      };
    }

    // Create the tags directory if it doesn't exist
    const tagsDir = `/tmp/${threadId.replace(/:/g, '_')}`;
    const tagsFile = `${tagsDir}/tags.json`;

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

    const clearRes = await this.execCommand(
      {
        cmd: `rm -f "${tagsFile}"`,
      },
      config,
      cfg,
    );

    if (clearRes.exitCode !== 0) {
      return {
        output: {
          error: `Failed to clear previous tags file: ${clearRes.stderr || clearRes.stdout}`,
        },
        messageMetadata,
      };
    }

    // Build ctags index without mutating session cwd (use subshell)
    const baseCmd = `ctags -R --fields=+n+K --extras=+q --output-format=json -f "${tagsFile}" .`;
    const cmd = args.directoryPath
      ? `cd "${args.directoryPath}" && ${baseCmd}`
      : baseCmd;

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
