import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { GhBaseTool, GhBaseToolConfig } from './gh-base.tool';
import { SemanticCommitType } from './gh-commit.tool';

export const GhBranchToolSchema = z.object({
  semanticType: z.enum(SemanticCommitType).describe('Semantic commit type'),
  title: z.string().min(1).describe('Branch title'),
  base: z
    .string()
    .optional()
    .describe('Base branch to create from (default: main)'),
  path: z
    .string()
    .optional()
    .describe('Path to the git repository (default: current directory)'),
});

export type GhBranchToolSchemaType = z.infer<typeof GhBranchToolSchema>;

type GhBranchToolOutput = {
  error?: string;
  success?: boolean;
  branchName?: string;
};

@Injectable()
export class GhBranchTool extends GhBaseTool<GhBranchToolSchemaType> {
  public name = 'gh_branch';
  public description =
    'Create a new git (GitHub) branch locally with a semantic branch name. The branch name will be formatted as "{semanticType}/{title}" where title is converted to lowercase with dashes.';

  public get schema() {
    return GhBranchToolSchema;
  }

  /**
   * Converts a title to a branch-friendly name (lowercase with dashes)
   */
  private formatBranchName(title: string): string {
    return title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and dashes
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .replace(/-+/g, '-') // Replace multiple dashes with single dash
      .replace(/^-|-$/g, ''); // Remove leading/trailing dashes
  }

  private buildCommand(cmd: string, path?: string): string {
    if (path) {
      return `cd ${JSON.stringify(path)} && ${cmd}`;
    }
    return cmd;
  }

  public async invoke(
    args: GhBranchToolSchemaType,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<GhBranchToolOutput> {
    const formattedTitle = this.formatBranchName(args.title);
    const branchName = `${args.semanticType}/${formattedTitle}`;
    const baseBranch = args.base || 'main';

    // First, checkout the base branch to ensure we're starting from the right point
    const checkoutBaseRes = await this.execGhCommand(
      {
        cmd: this.buildCommand(`git checkout ${baseBranch}`, args.path),
      },
      config,
      cfg,
    );

    if (checkoutBaseRes.exitCode !== 0) {
      return {
        error: `Failed to checkout base branch '${baseBranch}': ${checkoutBaseRes.stderr || checkoutBaseRes.stdout || 'Unknown error'}`,
        success: false,
      };
    }

    // Create and checkout the new branch
    const branchRes = await this.execGhCommand(
      {
        cmd: this.buildCommand(
          `git checkout -b ${JSON.stringify(branchName)}`,
          args.path,
        ),
      },
      config,
      cfg,
    );

    if (branchRes.exitCode !== 0) {
      return {
        error:
          branchRes.stderr || branchRes.stdout || 'Failed to create branch',
        success: false,
      };
    }

    return {
      success: true,
      branchName,
    };
  }
}
