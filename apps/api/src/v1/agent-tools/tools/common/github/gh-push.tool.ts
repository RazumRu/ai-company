import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { GhBaseTool, GhBaseToolConfig } from './gh-base.tool';

export const GhPushToolSchema = z.object({
  path: z
    .string()
    .optional()
    .describe('Path to the git repository (default: current directory)'),
  remote: z
    .string()
    .optional()
    .describe('Remote name to push to (default: origin)'),
  branch: z
    .string()
    .optional()
    .describe('Branch name to push (default: current branch)'),
});

export type GhPushToolSchemaType = z.infer<typeof GhPushToolSchema>;

type GhPushToolOutput = {
  error?: string;
  success?: boolean;
};

@Injectable()
export class GhPushTool extends GhBaseTool<GhPushToolSchemaType> {
  public name = 'gh_push';
  public description =
    'Push commits from a local git (GitHub) repository to a remote repository. Optionally specify the remote name and branch name.';

  public get schema() {
    return GhPushToolSchema;
  }

  private buildCommand(cmd: string, path?: string): string {
    if (path) {
      return `cd ${JSON.stringify(path)} && ${cmd}`;
    }
    return cmd;
  }

  public async invoke(
    args: GhPushToolSchemaType,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<GhPushToolOutput> {
    const remote = args.remote || 'origin';

    // Build git push command
    // If branch is specified, push to remote/branch, otherwise push current branch
    const pushCmd = args.branch
      ? `git push ${JSON.stringify(remote)} ${JSON.stringify(args.branch)}`
      : `git push ${JSON.stringify(remote)}`;

    const pushRes = await this.execGhCommand(
      {
        cmd: this.buildCommand(pushCmd, args.path),
      },
      config,
      cfg,
    );

    if (pushRes.exitCode !== 0) {
      return {
        success: false,
        error: pushRes.stderr || pushRes.stdout || 'Failed to push commits',
      };
    }

    return {
      success: true,
    };
  }
}
