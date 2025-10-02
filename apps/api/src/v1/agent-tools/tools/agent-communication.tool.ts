import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AgentOutput } from '../../agents/services/agents/base-agent';
import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { BaseTool } from './base-tool';

export interface AgentCommunicationToolOptions {
  invokeAgent: <T = AgentOutput>(
    messages: string[],
    childThreadId: string,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ) => Promise<T>;
}

export const AgentCommunicationSchema = z.object({
  messages: z
    .array(z.string().min(1))
    .min(1, 'Provide at least one message')
    .max(10, 'Max 10 messages'),
  childThreadId: z
    .string()
    .min(1)
    .describe(
      'Required child thread identifier used to maintain a persistent conversation with the child agent. Use the same value to continue the same conversation across multiple calls; use a new value to start a separate conversation. The effective child thread is computed as `${parentThreadId}__${childThreadId}`.',
    ),
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
      throw new Error('Agent communication is not configured');
    }

    const response = await config.invokeAgent(
      args.messages,
      args.childThreadId,
      runnableConfig,
    );

    return response;
  }
}
