import { HumanMessage } from '@langchain/core/messages';
import {
  DynamicStructuredTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { z } from 'zod';

import {
  AgentCommunicationTool,
  AgentCommunicationToolOptions,
} from '../../agent-tools/tools/agent-communication.tool';
import { AgentOutput } from '../../agents/services/agents/base-agent';
import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { CompiledGraphNode } from '../graphs.types';
import { SimpleAgentTemplateResult } from './base-node.template';
import { ToolNodeBaseTemplate } from './base-node.template';
import { SimpleAgentTemplateSchemaType } from './simple-agent.template';

export const AgentCommunicationToolTemplateSchema = z.object({
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  agentId: z.string().min(1, 'Target agent id is required'),
});

@Injectable()
export class AgentCommunicationToolTemplate extends ToolNodeBaseTemplate<
  typeof AgentCommunicationToolTemplateSchema
> {
  readonly name = 'agent-communication-tool';
  readonly description =
    'Allows an agent to initiate communication with another agent via an internal request pipeline.';
  readonly schema = AgentCommunicationToolTemplateSchema;

  constructor(private readonly agentCommunicationTool: AgentCommunicationTool) {
    super();
  }

  async create(
    config: z.infer<typeof AgentCommunicationToolTemplateSchema>,
    compiledNodes: Map<string, CompiledGraphNode>,
  ): Promise<DynamicStructuredTool> {
    const targetAgentNode = compiledNodes.get(config.agentId) as
      | CompiledGraphNode<SimpleAgentTemplateResult<unknown>>
      | undefined;

    if (!targetAgentNode) {
      throw new NotFoundException(
        'NODE_NOT_FOUND',
        `Agent node ${config.agentId} not found for communication tool`,
      );
    }

    const invokeAgent: AgentCommunicationToolOptions['invokeAgent'] = async <
      T = AgentOutput,
    >(
      messages: string[],
      childThreadId: string,
      runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
    ): Promise<T> => {
      const agentNode = compiledNodes.get(config.agentId) as
        | CompiledGraphNode<
            SimpleAgentTemplateResult<SimpleAgentTemplateSchemaType>
          >
        | undefined;

      if (!agentNode) {
        throw new NotFoundException(
          'TARGET_AGENT_NOT_FOUND',
          `Agent ${config.agentId} is not available for communication`,
        );
      }

      const agent = agentNode.instance.agent;
      const agentConfig = agentNode.instance.config;

      const preparedMessages = messages.map((msg) => new HumanMessage(msg));

      // Get parent thread ID from runnableConfig
      const parentThreadId =
        runnableConfig.configurable?.thread_id || `inter-agent-${Date.now()}`;

      // Compute effective child thread ID using the pattern: ${parentThreadId}__${childThreadId}
      // This allows for persistent conversations with child agents while maintaining separation
      const effectiveThreadId = `${parentThreadId}__${childThreadId}`;

      const response = await agent.run(
        effectiveThreadId,
        preparedMessages,
        agentConfig,
        runnableConfig,
      );

      return response as T;
    };

    return this.agentCommunicationTool.build({
      invokeAgent,
    });
  }
}
