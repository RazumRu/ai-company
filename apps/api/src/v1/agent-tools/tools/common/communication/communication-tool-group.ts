import { Injectable } from '@nestjs/common';

import {
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
} from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { CommunicationExecTool } from './communication-exec.tool';
import { BaseCommunicationToolConfig } from './communication-tools.types';

@Injectable()
export class CommunicationToolGroup extends BaseToolGroup<BaseCommunicationToolConfig> {
  constructor(private readonly communicationExecTool: CommunicationExecTool) {
    super();
  }

  protected buildToolsInternal(
    config: BaseCommunicationToolConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): BuiltAgentTool[] {
    return [this.communicationExecTool.build(config, lgConfig)];
  }
}
