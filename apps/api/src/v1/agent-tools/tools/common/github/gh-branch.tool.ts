import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { zodToAjvSchema } from '../../../agent-tools.utils';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
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
    'Create a new git (GitHub) branch locally with a semantic branch name.';

  protected override generateTitle(
    args: GhBranchToolSchemaType,
    _config: GhBaseToolConfig,
  ): string {
    return `Creating branch ${args.semanticType}/${this.formatBranchName(args.title)}`;
  }

  public getDetailedInstructions(
    _config: GhBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Creates new git branch with semantic naming: "{semanticType}/{title-in-kebab-case}".

      ### When to Use
      Starting work on feature/fix. Creating branch before making changes. Setting up for future PR.

      ### When NOT to Use
      Want custom format → use shell with git checkout -b. Switching to existing branch → use shell with git checkout. Repo not cloned → use gh_clone first.

      ### Best Practices
      Choose appropriate semantic type (feat, fix, refactor). Use descriptive titles. Keep titles concise for readable branch names.

      ### Examples
      **1. Feature branch:**
      \`\`\`json
      {"semanticType": "feat", "title": "Add OAuth Support", "path": "/repo"}
      \`\`\`

      **2. Bug fix:**
      \`\`\`json
      {"semanticType": "fix", "title": "Resolve Null Pointer", "path": "/repo"}
      \`\`\`

      **3. After cd into repo:**
      \`\`\`json
      {"semanticType": "refactor", "title": "Extract Validation Logic"}
      \`\`\`
    `;
  }

  public get schema() {
    return zodToAjvSchema(GhBranchToolSchema);
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
      const p = JSON.stringify(path);
      return `cd ${p} && ${cmd}`;
    }
    return cmd;
  }

  public async invoke(
    args: GhBranchToolSchemaType,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<GhBranchToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

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
        output: {
          error: `Failed to checkout base branch '${baseBranch}': ${checkoutBaseRes.stderr || checkoutBaseRes.stdout || 'Unknown error'}`,
          success: false,
        },
        messageMetadata,
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
        output: {
          error:
            branchRes.stderr || branchRes.stdout || 'Failed to create branch',
          success: false,
        },
        messageMetadata,
      };
    }

    return {
      output: {
        success: true,
        branchName,
      },
      messageMetadata,
    };
  }
}
