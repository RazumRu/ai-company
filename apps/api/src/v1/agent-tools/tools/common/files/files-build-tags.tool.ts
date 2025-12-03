import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { FilesBaseTool, FilesBaseToolConfig } from './files-base.tool';

export const FilesBuildTagsToolSchema = z.object({
  dir: z
    .string()
    .min(1)
    .describe('Path to the repository directory to search in.'),
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

  public get schema() {
    return FilesBuildTagsToolSchema;
  }

  public async invoke(
    args: FilesBuildTagsToolSchemaType,
    config: FilesBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<FilesBuildTagsToolOutput> {
    const threadId =
      cfg.configurable?.parent_thread_id ||
      cfg.configurable?.thread_id ||
      'unknown';

    // Create the tags directory if it doesn't exist
    const tagsDir = `/tmp/${threadId}`;
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
        error: `Failed to create tags directory: ${mkdirRes.stderr || mkdirRes.stdout}`,
      };
    }

    // Build ctags index
    const cmd = `cd "${args.dir}" && ctags -R --fields=+n+K --extras=+q --output-format=json -f "${tagsFile}" .`;

    const res = await this.execCommand(
      {
        cmd,
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      return {
        error: res.stderr || res.stdout || 'Failed to build tags',
      };
    }

    return {
      success: true,
      tagsFile,
    };
  }
}
