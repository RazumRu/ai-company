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
  public description = 'Build a ctags index (JSON) for fast symbol search.';

  protected override generateTitle(
    args: FilesBuildTagsToolSchemaType,
    _config: FilesBaseToolConfig,
  ): string {
    const dir = args.dir ?? 'current directory';
    return `Building tags "${args.alias}" in ${dir}`;
  }

  public getDetailedInstructions(
    _config: FilesBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Builds a \`ctags\` index in JSON format for fast, precise symbol lookups. This enables \`files_search_tags\` to find definitions (classes/functions/methods) without noisy text search.

      ### When to Use
      - You’re starting work in a new/large repo and want fast “jump to definition”
      - You plan to use \`files_search_tags\` repeatedly
      - Text search is too noisy or slow for symbol discovery

      ### When NOT to Use
      - You only need plain content search/usages → use \`files_search_text\`
      - The repo is small and \`files_search_text\` is already fast enough

      ### Best Practices
      - Use a stable \`alias\` per repo (e.g. "project") so you can reuse it across many \`files_search_tags\` calls.
      - Rebuild tags after large refactors or when definitions aren’t found (the index is not automatically updated).
      - If you already \`cd\`’d into the repo using \`shell\`, omit \`dir\` to use the persistent session cwd.

      ### Examples
      **1) Build tags for a repo:**
      \`\`\`json
      {"dir":"/repo","alias":"project"}
      \`\`\`

      **2) Build tags for current directory (after \`shell\` cd):**
      \`\`\`json
      {"alias":"project"}
      \`\`\`

      ### Output Format
      Success:
      \`\`\`json
      { "success": true, "tagsFile": "/tmp/<threadId>/project.json" }
      \`\`\`
      Error:
      \`\`\`json
      { "error": "Failed to build tags" }
      \`\`\`

      ### Next Step
      After building, use \`files_search_tags\` with the same \`alias\` to query symbols.
    `;
  }

  public get schema() {
    return z.toJSONSchema(FilesBuildTagsToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
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
