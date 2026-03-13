import { Injectable } from '@nestjs/common';
import dedent from 'dedent';

import {
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
} from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { GhBaseToolConfig } from './gh-base.tool';
import { GhBranchTool } from './gh-branch.tool';
import { GhCloneTool } from './gh-clone.tool';
import { GhCommitTool } from './gh-commit.tool';
import { GhCreatePullRequestTool } from './gh-create-pull-request.tool';
import { GhPushTool } from './gh-push.tool';

export enum GhToolType {
  Clone = 'clone',
  Commit = 'commit',
  Branch = 'branch',
  Push = 'push',
  CreatePullRequest = 'create_pull_request',
}

export type GhToolGroupConfig = GhBaseToolConfig & {
  tools?: GhToolType[];
  /**
   * Labels that will always be applied when creating PRs via `gh_create_pull_request`.
   * These are merged with any labels passed at invocation time.
   */
  additionalLabels?: string[];
};

@Injectable()
export class GhToolGroup extends BaseToolGroup<GhToolGroupConfig> {
  constructor(
    private readonly ghCloneTool: GhCloneTool,
    private readonly ghCommitTool: GhCommitTool,
    private readonly ghBranchTool: GhBranchTool,
    private readonly ghPushTool: GhPushTool,
    private readonly ghCreatePullRequestTool: GhCreatePullRequestTool,
  ) {
    super();
  }

  public getDetailedInstructions(
    _config: GhToolGroupConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ## Git Workflow — Required Tool Order

      Follow this exact sequence when delivering code via Git:

      1. \`gh_clone\` → clone the repository
      2. \`gh_branch\` → create and checkout a feature branch
      3. Make changes with file tools
      4. \`gh_commit\` → commit changes
      5. \`gh_push\` → push the branch to remote
      6. **Wait for \`gh_push\` result** — check that \`"success": true\`
      7. \`gh_create_pull_request\` → open a PR (only after push succeeded)

      ### ⚠️ CRITICAL — Sequential Dependency Rules

      **\`gh_push\` and \`gh_create_pull_request\` must NEVER be called in the same parallel batch.**
      These tools have a strict sequential dependency: the PR can only reference commits that exist on the remote.
      If you call both in parallel, the PR may be created before the push completes — pointing to a branch with stale or missing commits.

      **If \`gh_push\` returns \`"success": false\`:**
      - Do NOT call \`gh_create_pull_request\`.
      - Do NOT call \`finish\` or report the task as complete.
      - Diagnose the push failure and attempt recovery (see \`gh_push\` instructions for details).
      - Only after a successful push should you proceed to create a PR.

      **A PR created from an unpushed branch is empty and useless** — it points to commits that don't exist on the remote. This is worse than no PR at all.
    `;
  }

  protected buildToolsInternal(
    config: GhToolGroupConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): BuiltAgentTool[] {
    const selectedTools = config.tools ?? [
      GhToolType.Clone,
      GhToolType.Commit,
      GhToolType.Branch,
      GhToolType.Push,
      GhToolType.CreatePullRequest,
    ];

    const tools: BuiltAgentTool[] = [];

    for (const toolType of selectedTools) {
      switch (toolType) {
        case GhToolType.Clone:
          tools.push(this.ghCloneTool.build(config, lgConfig));
          break;
        case GhToolType.Commit:
          tools.push(this.ghCommitTool.build(config, lgConfig));
          break;
        case GhToolType.Branch:
          tools.push(this.ghBranchTool.build(config, lgConfig));
          break;
        case GhToolType.Push:
          tools.push(this.ghPushTool.build(config, lgConfig));
          break;
        case GhToolType.CreatePullRequest:
          tools.push(this.ghCreatePullRequestTool.build(config, lgConfig));
          break;
      }
    }

    return tools;
  }
}
