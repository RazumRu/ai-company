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
} from '../../../agent-tools/tools/agent-communication.tool';
import { AgentOutput } from '../../../agents/services/agents/base-agent';
import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { SimpleAgentTemplateSchemaType } from '../agents/simple-agent.template';
import {
  NodeBaseTemplateMetadata,
  SimpleAgentTemplateResult,
  ToolNodeBaseTemplate,
} from '../base-node.template';

export const AgentCommunicationToolTemplateSchema = z
  .object({
    metadata: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    agentId: z.string().min(1, 'Target agent id is required'),
  })
  .strict();

@Injectable()
@RegisterTemplate()
export class AgentCommunicationToolTemplate extends ToolNodeBaseTemplate<
  typeof AgentCommunicationToolTemplateSchema
> {
  readonly name = 'agent-communication-tool';
  readonly description =
    'Allows an agent to initiate communication with another agent via an internal request pipeline.';
  readonly schema = AgentCommunicationToolTemplateSchema;

  readonly inputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  readonly outputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  constructor(private readonly agentCommunicationTool: AgentCommunicationTool) {
    super();
  }

  async create(
    config: z.infer<typeof AgentCommunicationToolTemplateSchema>,
    connectedNodes: Map<string, CompiledGraphNode>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<DynamicStructuredTool> {
    const invokeAgent: AgentCommunicationToolOptions['invokeAgent'] = async <
      T = AgentOutput,
    >(
      messages: string[],
      childThreadId: string,
      runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
    ): Promise<T> => {
      const agentNode = connectedNodes.get(config.agentId) as
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

      // Enrich runnableConfig with graph and node metadata
      const enrichedConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        ...runnableConfig,
        configurable: {
          ...runnableConfig.configurable,
          thread_id: effectiveThreadId,
          graph_id: metadata.graphId,
          node_id: metadata.nodeId,
        },
      };

      const response = await agent.run(
        effectiveThreadId,
        preparedMessages,
        agentConfig,
        enrichedConfig,
      );

      return response as T;
    };

    return this.agentCommunicationTool.build({
      invokeAgent,
    });
  }
}
