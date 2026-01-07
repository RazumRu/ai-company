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
import { GhPushTool } from './gh-push.tool';

export enum GhToolType {
  CLONE = 'clone',
  COMMIT = 'commit',
  BRANCH = 'branch',
  PUSH = 'push',
}

export type GhToolGroupConfig = GhBaseToolConfig & {
  tools?: GhToolType[];
};

@Injectable()
export class GhToolGroup extends BaseToolGroup<GhToolGroupConfig> {
  constructor(
    private readonly ghCloneTool: GhCloneTool,
    private readonly ghCommitTool: GhCommitTool,
    private readonly ghBranchTool: GhBranchTool,
    private readonly ghPushTool: GhPushTool,
  ) {
    super();
  }

  protected buildToolsInternal(
    config: GhToolGroupConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): BuiltAgentTool[] {
    const selectedTools = config.tools ?? [
      GhToolType.CLONE,
      GhToolType.COMMIT,
      GhToolType.BRANCH,
      GhToolType.PUSH,
    ];

    const tools: BuiltAgentTool[] = [];

    for (const toolType of selectedTools) {
      switch (toolType) {
        case GhToolType.CLONE:
          tools.push(this.ghCloneTool.build(config, lgConfig));
          break;
        case GhToolType.COMMIT:
          tools.push(this.ghCommitTool.build(config, lgConfig));
          break;
        case GhToolType.BRANCH:
          tools.push(this.ghBranchTool.build(config, lgConfig));
          break;
        case GhToolType.PUSH:
          tools.push(this.ghPushTool.build(config, lgConfig));
          break;
      }
    }

    return tools;
  }
}
