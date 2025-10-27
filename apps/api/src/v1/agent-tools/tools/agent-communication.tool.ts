import {
  DynamicStructuredTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import { z } from 'zod';

import { AgentOutput } from '../../agents/services/agents/base-agent';
import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { BaseTool } from './base-tool';

export interface AgentCommunicationToolOptions {
  description?: string;
  invokeAgent: <T = AgentOutput>(
    messages: string[],
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ) => Promise<T>;
}

export const AgentCommunicationSchema = z.object({
  messages: z
    .array(z.string().min(1))
    .min(1, 'Provide at least one message')
    .max(10, 'Max 10 messages'),
});
export type AgentCommunicationSchemaType = z.infer<
  typeof AgentCommunicationSchema
>;

@Injectable()
export class AgentCommunicationTool extends BaseTool<
  AgentCommunicationSchemaType,
  AgentCommunicationToolOptions
> {
  public name = 'agent-communication';
  public description =
    'Request assistance from another registered agent by providing target agent id, context messages, and optional payload.';

  public get schema() {
    return AgentCommunicationSchema;
  }

  public async invoke(
    args: AgentCommunicationSchemaType,
    config: AgentCommunicationToolOptions,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ) {
    if (!config?.invokeAgent) {
      throw new BadRequestException(
        undefined,
        'Agent communication is not configured',
      );
    }

    return config.invokeAgent(args.messages, runnableConfig);
  }

  public build(
    config: AgentCommunicationToolOptions,
    lgConfig?: any,
  ): DynamicStructuredTool {
    const enhancedDescription = config.description
      ? `${this.description}\n\n${config.description}`
      : this.description;

    return this.toolWrapper(this.invoke, config, {
      ...lgConfig,
      description: enhancedDescription,
    });
  }
}
