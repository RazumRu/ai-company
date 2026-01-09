import { Injectable } from '@nestjs/common';

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
