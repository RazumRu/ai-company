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
    description: z.string().optional(),
    metadata: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
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
    _inputNodes: Map<string, CompiledGraphNode>,
    outputNodes: Map<string, CompiledGraphNode>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<DynamicStructuredTool> {
    const invokeAgent: AgentCommunicationToolOptions['invokeAgent'] = async <
      T = AgentOutput,
    >(
      messages: string[],
      runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
    ): Promise<T> => {
      // Search for agent nodes in output nodes
      const agentNodes = Array.from(outputNodes.values()).filter(
        (node) => node.type === NodeKind.SimpleAgent,
      ) as CompiledGraphNode<
        SimpleAgentTemplateResult<SimpleAgentTemplateSchemaType>
      >[];

      if (agentNodes.length === 0) {
        throw new NotFoundException(
          'TARGET_AGENT_NOT_FOUND',
          'No agent nodes found in output nodes for communication',
        );
      }

      // Use the first available agent (in the future, this could be made configurable)
      const agentNode = agentNodes[0];

      if (!agentNode) {
        throw new NotFoundException(
          'TARGET_AGENT_NOT_FOUND',
          'No valid agent node found for communication',
        );
      }

      const agent = agentNode.instance.agent;
      const agentConfig = agentNode.instance.config;

      const preparedMessages = messages.map((msg) => new HumanMessage(msg));

      // Get parent thread ID from runnableConfig - this should be the root thread ID from the trigger
      // If not present, use the current thread_id as fallback
      const rootParentThreadId =
        runnableConfig.configurable?.parent_thread_id ||
        runnableConfig.configurable?.thread_id ||
        `inter-agent-${Date.now()}`;

      // For consistent conversation flow, use the parent thread ID as the base
      // This ensures that Agent A -> Agent B -> Agent C all share the same conversation context
      // Only create a new thread ID if we don't have a parent thread ID
      const effectiveThreadId = `${rootParentThreadId}__${metadata.nodeId}`;

      // Enrich runnableConfig with graph and node metadata
      // Pass the same parent_thread_id so all agents share the same internal thread
      const enrichedConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        ...runnableConfig,
        configurable: {
          ...runnableConfig.configurable,
          thread_id: effectiveThreadId,
          graph_id: metadata.graphId,
          node_id: agentNode.id,
          parent_thread_id: rootParentThreadId,
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
      description: config.description,
    });
  }
}
