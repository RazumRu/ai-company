import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseTool } from '../../base-tool';
import { BaseCommunicationToolConfig } from './communication-tools.types';

export const CommunicationListSchema = z.object({});

export type CommunicationListSchemaType = z.infer<
  typeof CommunicationListSchema
>;

@Injectable()
export class CommunicationListTool extends BaseTool<
  CommunicationListSchemaType,
  BaseCommunicationToolConfig
> {
  public name = 'communication_list';
  public description =
    'Get the list of all available agents that can be communicated with. Returns array of agents with their names and descriptions.';

  public get schema() {
    return CommunicationListSchema;
  }

  public async invoke(
    _args: CommunicationListSchemaType,
    config: BaseCommunicationToolConfig,
    _runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ) {
    if (!config?.agents) {
      return [];
    }

    return config.agents.map((agent) => ({
      name: agent.name,
      description: agent.description,
    }));
  }
}
