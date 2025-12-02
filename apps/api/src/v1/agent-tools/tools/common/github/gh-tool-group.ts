import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';

import { ExtendedLangGraphRunnableConfig } from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { GhBaseToolConfig } from './gh-base.tool';
import { GhCloneTool } from './gh-clone.tool';

export type GhToolGroupConfig = GhBaseToolConfig;

@Injectable()
export class GhToolGroup extends BaseToolGroup<GhToolGroupConfig> {
  constructor(private readonly ghCloneTool: GhCloneTool) {
    super();
  }

  public buildTools(
    config: GhToolGroupConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): DynamicStructuredTool[] {
    const tools = [this.ghCloneTool.build(config, lgConfig)];

    return tools;
  }
}
