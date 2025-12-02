import path from 'node:path';

import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { GhBaseTool, GhBaseToolConfig, GhBaseToolSchema } from './gh-base.tool';

export const GhCloneToolSchema = GhBaseToolSchema.extend({
  branch: z
    .union([z.string(), z.null()])
    .optional()
    .describe('Optional branch or tag to checkout.'),
  depth: z
    .union([z.number().int().positive(), z.null()])
    .optional()
    .describe('Shallow clone depth (omit for full clone).'),
});

export type GhCloneToolSchemaType = z.infer<typeof GhCloneToolSchema>;

type GhCloneToolOutput = {
  error?: string;
  path?: string;
};

@Injectable()
export class GhCloneTool extends GhBaseTool<GhCloneToolSchemaType> {
  public name = 'gh_clone';
  public description =
    'Clone a GitHub repository into the running container at the specified path using authenticated HTTPS.';

  public get schema() {
    return GhCloneToolSchema;
  }

  public async invoke(
    args: GhCloneToolSchemaType,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<GhCloneToolOutput> {
    const cmd = [`gh repo clone ${args.owner}/${args.repo}`];

    if (args.branch || args.depth) {
      cmd.push('--');
    }

    if (args.branch) {
      cmd.push(`--branch ${args.branch}`);
    }

    if (args.depth) {
      cmd.push(`--depth ${args.depth}`);
    }

    const res = await this.execGhCommand(
      {
        cmd: cmd.join(' '),
      },
      config,
      cfg,
    );

    if (res.exitCode !== 0) {
      return {
        error: res.stderr || res.stdout || 'Failed to clone repository',
      };
    }

    return {
      path: path.join(res.execPath || '', args.repo),
    };
  }
}
