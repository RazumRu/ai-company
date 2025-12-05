import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { ExtendedLangGraphRunnableConfig } from '../../base-tool';
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

  public getDetailedInstructions(
    config: GhBaseToolConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Pushes local commits to the remote GitHub repository. Uses the configured authentication automatically for secure push access.

      ### When to Use
      - After creating one or more commits locally
      - When you're ready to share changes with the remote repository
      - Before creating a pull request
      - After completing a feature or fix

      ### When NOT to Use
      - No commits exist → create commits with \`gh_commit\` first
      - On a protected branch → may need to use PR workflow
      - Unpushed changes need review → wait for confirmation

      ${parameterDocs}

      ### Best Practices

      **1. Push after commits are ready:**
      \`\`\`
      1. Make all intended changes
      2. Stage and commit with gh_commit
      3. Review commits if needed (git log)
      4. Push once ready
      \`\`\`

      **2. Push feature branches, not main:**
      \`\`\`json
      // Good: Push feature branch
      {"path": "/repo", "branch": "feat/add-authentication"}

      // Caution: Direct push to main may be blocked
      {"path": "/repo", "branch": "main"}
      \`\`\`

      **3. Verify branch before pushing:**
      Use shell to check current branch:
      \`\`\`bash
      cd /repo && git branch --show-current
      \`\`\`

      ### Output Format
      Success:
      \`\`\`json
      {
        "success": true
      }
      \`\`\`

      Error:
      \`\`\`json
      {
        "success": false,
        "error": "error: failed to push some refs to 'origin'"
      }
      \`\`\`

      ### Common Errors and Solutions

      | Error | Cause | Solution |
      |-------|-------|----------|
      | "rejected - non-fast-forward" | Remote has new commits | Pull first, resolve conflicts |
      | "Permission denied" | Auth issue | Check PAT token permissions |
      | "protected branch" | Branch protection rules | Create PR instead |
      | "no upstream branch" | New branch not tracked | Use -u flag via shell |

      ### Complete Workflow
      \`\`\`
      1. gh_clone → Get repository
      2. gh_branch → Create feature branch
      3. Make changes with files_apply_changes
      4. Stage with shell: git add -A
      5. gh_commit → Commit changes
      6. gh_push → Push to remote
      7. Create PR on GitHub
      \`\`\`

      ### First-Time Branch Push
      For new branches that don't exist on remote, the tool handles this automatically. The branch will be created on the remote.

      ### Force Push (Not Recommended)
      This tool doesn't support force push. If you need to force push (be careful!), use shell:
      \`\`\`bash
      cd /repo && git push --force origin branch-name
      \`\`\`
      Warning: Force push can lose commit history on the remote.

      ### Authentication
      - Uses configured GitHub PAT token
      - Token must have \`repo\` scope for pushing
      - Private repos require appropriate access

      ### Troubleshooting
      - "No commits to push" → Create commits first with \`gh_commit\`
      - "Remote rejected" → Check branch protection or permission issues
      - "Connection refused" → Check network and GitHub status
    `;
  }

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
