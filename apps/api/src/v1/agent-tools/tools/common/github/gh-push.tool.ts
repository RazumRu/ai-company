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

export const GhPushToolSchema = z.object({
  path: z
    .string()
    .describe(
      'Absolute path to the git repository root (use the path returned by gh_clone).',
    ),
  remote: z
    .string()
    .optional()
    .describe(
      'Remote name to push to (default: "origin"). Rarely needs to be changed.',
    ),
  branch: z
    .string()
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
    'Push local commits to the remote GitHub repository. Pushes to the specified branch or the current branch if none is specified. Use this after creating commits with gh_commit.';

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
      Always pass \`path\` (use the path returned by gh_clone). Push feature branches, not main (may be blocked). Verify current branch before pushing with shell: \`git branch --show-current\`.

      ### Examples
      **1. Push feature branch:**
      \`\`\`json
      {"path": "/runtime-workspace/repo", "branch": "feat/add-authentication"}
      \`\`\`

      **2. Push current branch:**
      \`\`\`json
      {"path": "/runtime-workspace/repo"}
      \`\`\`

      ### Common Errors
      "rejected - non-fast-forward" → Pull first. "Permission denied" → Check PAT token. "protected branch" → Create PR instead
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

  public async invoke(
    args: GhPushToolSchemaType,
    config: GhBaseToolConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<GhPushToolOutput>> {
    const title = this.generateTitle?.(args, config);
    const messageMetadata = { __title: title };

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
