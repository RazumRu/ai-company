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
} from '../../../agent-tools/tools/core/agent-communication.tool';
import { AgentOutput } from '../../../agents/services/agents/base-agent';
import { SimpleAgent } from '../../../agents/services/agents/simple-agent';
import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import { NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  ToolNodeBaseTemplate,
} from '../base-node.template';

export const AgentCommunicationToolTemplateSchema = z
  .object({
    description: z.string().optional().meta({ 'x-ui:textarea': true }),
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
  readonly id = 'agent-communication-tool';
  readonly name = 'Agent communication';
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

  constructor(
    private readonly agentCommunicationTool: AgentCommunicationTool,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  async create(
    config: z.infer<typeof AgentCommunicationToolTemplateSchema>,
    _inputNodeIds: Set<string>,
    outputNodeIds: Set<string>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<DynamicStructuredTool[]> {
    // Get agent node IDs from output nodes
    const agentNodeIds = this.graphRegistry.filterNodesByType(
      metadata.graphId,
      outputNodeIds,
      NodeKind.SimpleAgent,
    );

    if (agentNodeIds.length === 0) {
      throw new NotFoundException(
        'TARGET_AGENT_NOT_FOUND',
        'No agent nodes found in output nodes for communication',
      );
    }

    // Store the first agent node ID
    const agentNodeId = agentNodeIds[0]!;

    const invokeAgent: AgentCommunicationToolOptions['invokeAgent'] = async <
      T = AgentOutput,
    >(
      messages: string[],
      runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
    ): Promise<T> => {
      // Look up the agent from the registry at runtime to get the current instance
      const agentNode = this.graphRegistry.getNode<SimpleAgent>(
        metadata.graphId,
        agentNodeId,
      );

      if (!agentNode) {
        throw new NotFoundException(
          'TARGET_AGENT_NOT_FOUND',
          `Agent node ${agentNodeId} not found in graph ${metadata.graphId}`,
        );
      }

      const agent = agentNode.instance;

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

      const preparedMessages = messages.map(
        (msg) =>
          new HumanMessage({
            content: msg,
            additional_kwargs: {
              isAgentInstructionMessage: true,
            },
          }),
      );

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

      const response = await agent.runOrAppend(
        effectiveThreadId,
        preparedMessages,
        undefined,
        enrichedConfig,
      );

      // Extract the last message content or finish tool message from the agent's response
      const lastMessage = response.messages[response.messages.length - 1];
      let responseMessage: string | undefined;
      let needsMoreInfo = false;

      if (lastMessage) {
        // Check if the last message is a tool message from finish tool
        if (lastMessage.type === 'tool' && lastMessage.name === 'finish') {
          const content =
            typeof lastMessage.content === 'string'
              ? lastMessage.content
              : JSON.stringify(lastMessage.content);

          // Try to parse the content to extract needsMoreInfo flag
          try {
            const parsedContent = JSON.parse(content);
            if (typeof parsedContent === 'object' && parsedContent !== null) {
              responseMessage = parsedContent.message || content;
              needsMoreInfo = parsedContent.needsMoreInfo === true;
            } else {
              responseMessage = content;
            }
          } catch {
            responseMessage = content;
          }
        } else if (lastMessage.type === 'ai') {
          // For AI messages, use the content
          responseMessage =
            typeof lastMessage.content === 'string'
              ? lastMessage.content
              : JSON.stringify(lastMessage.content);
        } else if (lastMessage.type === 'human') {
          // For human messages, use the content
          responseMessage =
            typeof lastMessage.content === 'string'
              ? lastMessage.content
              : JSON.stringify(lastMessage.content);
        }
      }

      // Return the agent's response message instead of all messages
      return {
        message: responseMessage || 'No response message available',
        needsMoreInfo,
        threadId: response.threadId,
        checkpointNs: response.checkpointNs,
      } as T;
    };

    return [
      this.agentCommunicationTool.build({
        invokeAgent,
        description: config.description,
      }),
    ];
  }
}
