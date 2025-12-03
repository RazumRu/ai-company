import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';

import { ExtendedLangGraphRunnableConfig } from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { CommunicationExecTool } from './communication-exec.tool';
import { CommunicationListTool } from './communication-list.tool';
import { BaseCommunicationToolConfig } from './communication-tools.types';

@Injectable()
export class CommunicationToolGroup extends BaseToolGroup<BaseCommunicationToolConfig> {
  constructor(
    private readonly communicationExecTool: CommunicationExecTool,
    private readonly communicationListTool: CommunicationListTool,
  ) {
    super();
  }

  public buildTools(
    config: BaseCommunicationToolConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): DynamicStructuredTool[] {
    const tools: DynamicStructuredTool[] = [];

    // Always add both tools
    tools.push(this.communicationExecTool.build(config, lgConfig));
    tools.push(this.communicationListTool.build(config, lgConfig));

    return tools;
  }
}
