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
  semanticType: z
    .enum(SemanticCommitType)
    .describe(
      'Semantic type prefix for the branch name (e.g., feat, fix, refactor). Combined with title to produce names like "feat/add-oauth-support".',
    ),
  title: z
    .string()
    .min(1)
    .describe(
      'Human-readable branch title that will be converted to kebab-case (e.g., "Add OAuth Support" becomes "add-oauth-support"). Keep it concise for readable branch names.',
    ),
  base: z
    .string()
    .nullable()
    .optional()
    .describe(
      'The base branch to create the new branch from (default: "main"). The tool checks out this branch first before creating the new one.',
    ),
  path: z
    .string()
    .describe(
      'Absolute path to the git repository root (use the path returned by gh_clone).',
    ),
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
    'Create and checkout a new local git branch with a semantic naming convention: "{semanticType}/{title-in-kebab-case}". Checks out the base branch first (default: main), then creates the new branch from it. Use this before making changes that will be pushed as a separate branch for a pull request. The repository must already be cloned with gh_clone.';

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
      Creates and checks out a new git branch with semantic naming: \`{semanticType}/{title-in-kebab-case}\`. The tool first checks out the base branch (default: \`main\`), then creates the new branch from it.

      ### When to Use
      - Starting work on a new feature, fix, or refactor
      - Setting up a branch before making changes for a future PR
      - Creating a branch after cloning with \`gh_clone\`

      ### When NOT to Use
      - Custom branch name format needed → use shell: \`git checkout -b my-custom-branch\`
      - Switching to an existing branch → use shell: \`git checkout branch-name\`
      - Repository not yet cloned → use \`gh_clone\` first

      ### Branch Name Format
      The title is automatically converted to kebab-case:
      - "Add OAuth Support" → \`feat/add-oauth-support\`
      - "Fix Login Bug" → \`fix/fix-login-bug\`
      - Special characters are removed, spaces become dashes

      ### Best Practices
      - Always pass \`path\` (use the exact path returned by \`gh_clone\`)
      - Choose the appropriate semantic type: \`feat\`, \`fix\`, \`refactor\`, \`docs\`, \`test\`, \`chore\`, etc.
      - Use descriptive but concise titles for readable branch names
      - Specify \`base\` if branching from something other than \`main\` (e.g., \`"base": "develop"\`)

      ### Typical Workflow
      1. \`gh_clone\` → clone the repo, get the path
      2. **\`gh_branch\`** → create and checkout a new branch
      3. Make changes with file tools
      4. Stage changes: shell \`git add .\`
      5. \`gh_commit\` → commit changes
      6. \`gh_push\` → push branch to remote
      7. \`gh_create_pull_request\` → open a PR

      ### Troubleshooting
      - "Failed to checkout base branch" → the base branch (e.g., \`main\`) doesn't exist; check with \`git branch -a\`
      - "Branch already exists" → a branch with that name already exists; use a different title or delete the old branch via shell
      - "Not a git repository" → \`path\` doesn't point to a git repo root; use the path from \`gh_clone\`

      ### Examples
      **1. Feature branch from main:**
      \`\`\`json
      {"semanticType": "feat", "title": "Add OAuth Support", "path": "/runtime-workspace/repo"}
      \`\`\`

      **2. Bug fix from develop:**
      \`\`\`json
      {"semanticType": "fix", "title": "Resolve Null Pointer", "base": "develop", "path": "/runtime-workspace/repo"}
      \`\`\`

      **3. Refactor branch:**
      \`\`\`json
      {"semanticType": "refactor", "title": "Extract Validation Logic", "path": "/runtime-workspace/repo"}
      \`\`\`
    `;
  }

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
