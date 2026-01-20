import { BaseMessage, HumanMessage } from '@langchain/core/messages';
import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { isObject } from 'lodash';
import type { JsonObject, JsonValue } from 'type-fest';
import { z } from 'zod';

import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import { CommunicationToolGroup } from '../../../agent-tools/tools/common/communication/communication-tool-group';
import { AgentInfo } from '../../../agent-tools/tools/common/communication/communication-tools.types';
import { AgentOutput } from '../../../agents/services/agents/base-agent';
import { SimpleAgent } from '../../../agents/services/agents/simple-agent';
import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import { GraphNode, NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { ToolNodeBaseTemplate } from '../base-node.template';

export const AgentCommunicationToolTemplateSchema = z
  .object({})
  // Strip legacy/unknown fields so older configs remain valid.
  .strip();

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
    private readonly communicationToolGroup: CommunicationToolGroup,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  public async create() {
    return {
      provide: async (
        _params: GraphNode<
          z.infer<typeof AgentCommunicationToolTemplateSchema>
        >,
      ) => ({ tools: [] }),
      configure: async (
        params: GraphNode<z.infer<typeof AgentCommunicationToolTemplateSchema>>,
        instance: { tools: BuiltAgentTool[]; instructions?: string },
      ) => {
        const outputNodeIds = params.outputNodeIds;
        const metadata = params.metadata;

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

        const agentInfos: AgentInfo[] = agentNodeIds.map((agentNodeId) => {
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

          const agentConfig = agentNode.config as {
            name: string;
            description: string;
          };

          if (!agentConfig.name || !agentConfig.description) {
            throw new NotFoundException(
              'AGENT_CONFIG_INVALID',
              `Agent node ${agentNodeId} must have name and description configured`,
            );
          }

          const invokeAgent = async <T = AgentOutput>(
            messages: string[],
            runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
          ): Promise<T> => {
            const currentAgentNode = this.graphRegistry.getNode<SimpleAgent>(
              metadata.graphId,
              agentNodeId,
            );

            if (!currentAgentNode) {
              throw new NotFoundException(
                'TARGET_AGENT_NOT_FOUND',
                `Agent node ${agentNodeId} not found in graph ${metadata.graphId}`,
              );
            }

            const agent = currentAgentNode.instance;

            const rootParentThreadId =
              runnableConfig.configurable?.parent_thread_id ||
              runnableConfig.configurable?.thread_id ||
              `inter-agent-${Date.now()}`;

            const effectiveThreadId = `${rootParentThreadId}__${metadata.nodeId}__${agentConfig.name}`;

            const preparedMessages = messages.map(
              (msg) =>
                new HumanMessage({
                  content: msg,
                  additional_kwargs: {
                    __isAgentInstructionMessage: true,
                    __interAgentCommunication: true,
                    __sourceAgentNodeId: runnableConfig.configurable?.node_id,
                    __createdAt: new Date().toISOString(),
                  },
                }),
            );

            const checkpointNs = `${effectiveThreadId}:${agentNodeId}`;

            const enrichedConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
              ...runnableConfig,
              configurable: {
                ...runnableConfig.configurable,
                thread_id: effectiveThreadId,
                graph_id: metadata.graphId,
                node_id: agentNodeId,
                parent_thread_id: rootParentThreadId,
                checkpoint_ns: checkpointNs,
                graph_created_by:
                  runnableConfig.configurable?.graph_created_by ??
                  metadata.graph_created_by,
                // Inter-agent communication metadata to propagate to all messages
                __interAgentCommunication: true,
                __sourceAgentNodeId: runnableConfig.configurable?.node_id,
              },
            };

            const response = await agent.runOrAppend(
              effectiveThreadId,
              preparedMessages,
              undefined,
              enrichedConfig,
            );

            // Extract the last message content or finish tool message from the agent's response
            // Skip system messages (like summary markers) by iterating backwards
            let lastMessage: BaseMessage | undefined;
            for (let i = response.messages.length - 1; i >= 0; i--) {
              const msg = response.messages[i];
              if (msg && msg.type !== 'system') {
                lastMessage = msg;
                break;
              }
            }

            let responseMessage: string | undefined;
            let needsMoreInfo = false;

            if (lastMessage) {
              // Check if the last message is a tool message from finish tool
              if (
                lastMessage.type === 'tool' &&
                lastMessage.name === 'finish'
              ) {
                const content =
                  typeof lastMessage.content === 'string'
                    ? lastMessage.content
                    : JSON.stringify(lastMessage.content);

                // Try to parse the content to extract needsMoreInfo flag
                try {
                  const parsedContent = JSON.parse(content) as JsonValue;
                  if (isObject(parsedContent)) {
                    const rec = parsedContent as JsonObject;
                    const parsedMessage = rec.message;

                    responseMessage =
                      typeof parsedMessage === 'string' &&
                      parsedMessage.length > 0
                        ? parsedMessage
                        : content;
                    needsMoreInfo = rec.needsMoreInfo === true;
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

          return {
            name: agentConfig.name,
            description: agentConfig.description,
            invokeAgent,
          };
        });

        const { tools, instructions } = this.communicationToolGroup.buildTools({
          agents: agentInfos,
        });

        instance.tools.length = 0;
        instance.tools.push(...tools);
        instance.instructions = instructions;
      },
      destroy: async (instance: { tools: BuiltAgentTool[] }) => {
        instance.tools.length = 0;
      },
    };
  }
}
