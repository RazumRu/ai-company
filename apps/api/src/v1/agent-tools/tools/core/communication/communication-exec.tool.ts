import {
  DynamicStructuredTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { BaseTool, ExtendedLangGraphRunnableConfig } from '../../base-tool';
import { BaseCommunicationToolConfig } from './communication-tools.types';

export const CommunicationExecSchema = z.object({
  message: z
    .string()
    .min(1)
    .describe('The message to send to the specified agent'),
  purpose: z
    .string()
    .min(1)
    .describe('Brief reason for using this tool. Keep it short (< 120 chars).'),
  agent: z
    .string()
    .min(1)
    .describe('Name of the target agent to communicate with'),
});

export type CommunicationExecSchemaType = z.infer<
  typeof CommunicationExecSchema
>;

@Injectable()
export class CommunicationExecTool extends BaseTool<
  CommunicationExecSchemaType,
  BaseCommunicationToolConfig
> {
  public name = 'communication_exec';
  public description =
    'Send a message to a specific agent. Use communication_list to see available agents and their descriptions.';

  public get schema() {
    return CommunicationExecSchema;
  }

  public async invoke(
    args: CommunicationExecSchemaType,
    config: BaseCommunicationToolConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ) {
    if (!config?.agents || config.agents.length === 0) {
      throw new BadRequestException(
        undefined,
        'No agents configured for communication',
      );
    }

    const targetAgent = config.agents.find(
      (agent) => agent.name === args.agent,
    );

    if (!targetAgent) {
      throw new BadRequestException(
        undefined,
        `Agent "${args.agent}" not found. Use communication_list to see available agents.`,
      );
    }

    return targetAgent.invokeAgent([args.message], runnableConfig);
  }

  public build(
    config: BaseCommunicationToolConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): DynamicStructuredTool {
    // Build description with list of available agents
    let enhancedDescription = this.description;

    if (config.agents && config.agents.length > 0) {
      const agentsList = config.agents
        .map((agent) => `  - ${agent.name}: ${agent.description}`)
        .join('\n');
      enhancedDescription += `\n\nAvailable agents:\n${agentsList}`;
    }

    return this.toolWrapper(this.invoke, config, {
      ...lgConfig,
      description: enhancedDescription,
    });
  }
}
