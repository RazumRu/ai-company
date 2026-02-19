import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BASE_RUNTIME_WORKDIR } from '../../../../runtime/services/base-runtime';
import {
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { GhBaseTool, GhBaseToolConfig } from './gh-base.tool';

export const GhPushToolSchema = z.object({
  path: z
    .string()
    .describe(
      'Absolute path to the git repository root (use the path returned by gh_clone).',
    ),
  remote: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Remote name to push to (default: "origin"). Rarely needs to be changed.',
    ),
  branch: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Branch name to push (e.g., "feat/add-authentication"). If omitted, pushes the currently checked-out branch.',
    ),
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
    'Push local commits to the remote GitHub repository using authenticated HTTPS. Pushes to the specified branch, or the currently checked-out branch if no branch is specified. Use this after creating commits with gh_commit. Will fail if no commits exist to push, or if the remote branch has diverged (non-fast-forward). Pushing directly to the repository default branch (e.g. main/master) is blocked — always create a feature branch and use gh_create_pull_request instead. The repository must already be cloned with gh_clone.';

  protected override generateTitle(
    args: GhPushToolSchemaType,
    _config: GhBaseToolConfig,
  ): string {
    const remote = args.remote || 'origin';
    const branch = args.branch ? ` ${args.branch}` : '';
    return `Pushing to ${remote}${branch}`;
  }

  public getDetailedInstructions(
    _config: GhBaseToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Pushes local commits to remote GitHub repository using configured authentication.

      ### When to Use
      After creating commits locally. When ready to share changes or create PR.

      ### When NOT to Use
      No commits exist → use gh_commit first. Protected branch → may need PR workflow. Changes need review → wait for confirmation.

      ### Best Practices
      Always pass \`path\` (use the path returned by gh_clone). Never push directly to the default branch — this tool will block it. Always work on a feature branch and open a pull request via gh_create_pull_request. Verify current branch before pushing with shell: \`git branch --show-current\`.

      ### Examples
      **1. Push feature branch:**
      \`\`\`json
      {"path": "${BASE_RUNTIME_WORKDIR}/repo", "branch": "feat/add-authentication"}
      \`\`\`

      **2. Push current branch:**
      \`\`\`json
      {"path": "${BASE_RUNTIME_WORKDIR}/repo"}
      \`\`\`

      ### Common Errors
      "Pushing to the default branch is not allowed" → You are on the default branch. Create a feature branch first, then push it. "rejected - non-fast-forward" → Pull first. "Permission denied" → Check PAT token. "protected branch" → Create PR instead
    `;
  }

  public get schema() {
    return GhPushToolSchema;
  }

  private buildCommand(cmd: string, path?: string): string {
    if (path) {
      const p = JSON.stringify(path);
      return `cd ${p} && ${cmd}`;
    }
    return cmd;
  }

  /**
   * Resolve the branch name that will be pushed.
   * If the caller specified a branch, use that; otherwise read the current HEAD.
   */
  private async resolveBranch(
    args: GhPushToolSchemaType,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<string | undefined> {
    if (args.branch) {
      return args.branch;
    }

    const res = await this.execGhCommand(
      {
        cmd: this.buildCommand('git symbolic-ref --short HEAD', args.path),
      },
      config,
      cfg,
    );

    if (res.exitCode === 0) {
      const branch = res.stdout.trim();
      if (branch.length > 0) {
        return branch;
      }
    }

    return undefined;
  }

  /**
   * Detect the remote default branch (e.g. main, master) via
   * `git symbolic-ref refs/remotes/<remote>/HEAD`.
   */
  private async detectDefaultBranch(
    args: GhPushToolSchemaType,
    remote: string,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<string | undefined> {
    const res = await this.execGhCommand(
      {
        cmd: this.buildCommand(
          `git symbolic-ref refs/remotes/${remote}/HEAD`,
          args.path,
        ),
      },
      config,
      cfg,
    );

    if (res.exitCode === 0) {
      // Output looks like: refs/remotes/origin/main
      const ref = res.stdout.trim();
      const branch = ref.replace(`refs/remotes/${remote}/`, '');
      if (branch.length > 0) {
        return branch;
      }
    }

    return undefined;
  }

  public async invoke(
    args: GhPushToolSchemaType,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<GhPushToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

    const remote = args.remote || 'origin';

    // Detect the branch being pushed and the remote default branch
    const [targetBranch, defaultBranch] = await Promise.all([
      this.resolveBranch(args, config, cfg),
      this.detectDefaultBranch(args, remote, config, cfg),
    ]);

    // Block pushes to the repository's default branch
    if (targetBranch && defaultBranch && targetBranch === defaultBranch) {
      return {
        output: {
          success: false,
          error: `Pushing to the default branch "${defaultBranch}" is not allowed. Create a feature branch and use gh_create_pull_request instead.`,
        },
        messageMetadata,
      };
    }

    // Build git push command
    // Always use -u to set upstream tracking, which is required for newly created branches
    const pushCmd = args.branch
      ? `git push -u ${JSON.stringify(remote)} ${JSON.stringify(args.branch)}`
      : `git push -u ${JSON.stringify(remote)} HEAD`;

    const pushRes = await this.execGhCommand(
      {
        cmd: this.buildCommand(pushCmd, args.path),
      },
      config,
      cfg,
    );

    if (pushRes.exitCode !== 0) {
      return {
        output: {
          success: false,
          error: pushRes.stderr || pushRes.stdout || 'Failed to push commits',
        },
        messageMetadata,
      };
    }

    return {
      output: {
        success: true,
      },
      messageMetadata,
    };
  }
}
