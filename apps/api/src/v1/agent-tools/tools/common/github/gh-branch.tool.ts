import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
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
      Creates a new git branch with a standardized semantic naming convention. Automatically formats the branch name as "{semanticType}/{title-in-kebab-case}".

      ### When to Use
      - Starting work on a new feature or fix
      - Creating a branch before making any changes
      - Following git flow or semantic branching conventions
      - Setting up for a future pull request

      ### When NOT to Use
      - You want a custom branch name format → use shell with \`git checkout -b\`
      - Just switching to existing branch → use shell with \`git checkout\`
      - Repository not yet cloned → use \`gh_clone\` first

      ### Best Practices

      **1. Choose appropriate semantic type:**
      \`\`\`json
        // Feature work
        {"semanticType": "feat", "title": "Add OAuth Support"}

        // Bug fix
        {"semanticType": "fix", "title": "Resolve Null Pointer in Parser"}

        // Refactoring
        {"semanticType": "refactor", "title": "Extract Validation Logic"}
      \`\`\`

      **2. Use descriptive titles:**
      \`\`\`json
        // Good: Specific and clear
        {"semanticType": "feat", "title": "Add Export to PDF Functionality"}

        // Avoid: Vague
        {"semanticType": "feat", "title": "Update Code"}
      \`\`\`

      **3. Keep titles concise:**
      The title will become part of the branch name, so keep it reasonably short.

      **Current directory example (after shell cd into repo):**
      \`\`\`json
        {"semanticType": "feat", "title": "Add OAuth Support"}
      \`\`\`

      ### Output Format
      Success:
      \`\`\`json
        {
          "success": true,
          "branchName": "feat/add-user-authentication"
        }
      \`\`\`

      Error:
      \`\`\`json
        {
          "success": false,
          "error": "Failed to checkout base branch 'main': fatal: not a git repository"
        }
      \`\`\`

      ### Common Workflow
      \`\`\`
      1. gh_clone → Clone the repository
      2. gh_branch → Create feature branch
      3. Make changes using files_apply_changes
      4. gh_commit → Commit changes
      5. gh_push → Push branch to remote
      6. Create PR via GitHub
      \`\`\`

      ### Troubleshooting
      - "Not a git repository" → Ensure path points to a cloned repo
      - "Branch already exists" → Choose a different title or use shell to checkout existing
      - "Failed to checkout base" → Verify the base branch exists
    `;
  }

  public get schema() {
    return z.toJSONSchema(GhBranchToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
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
