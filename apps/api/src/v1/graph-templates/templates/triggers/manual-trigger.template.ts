import { HumanMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DefaultLogger, NotFoundException } from '@packages/common';
import { v4 } from 'uuid';
import { z } from 'zod';

import { ManualTrigger } from '../../../agent-triggers/services/manual-trigger';
import { SimpleAgent } from '../../../agents/services/agents/simple-agent';
import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import {
  CompiledGraphNode as _CompiledGraphNode,
  NodeKind,
} from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  TriggerNodeBaseTemplate,
} from '../base-node.template';

/**
 * Manual trigger template schema
 */
export const ManualTriggerTemplateSchema = z.object({}).strict();

export type ManualTriggerTemplateSchemaType = z.infer<
  typeof ManualTriggerTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class ManualTriggerTemplate extends TriggerNodeBaseTemplate<
  typeof ManualTriggerTemplateSchema,
  ManualTrigger
> {
  readonly id = 'manual-trigger';
  readonly name = 'Manual';
  readonly description = 'Manual trigger for direct agent invocation';
  readonly schema = ManualTriggerTemplateSchema;

  readonly outputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly logger: DefaultLogger,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  async create(
    config: ManualTriggerTemplateSchemaType,
    _inputNodeIds: Set<string>,
    outputNodeIds: Set<string>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<ManualTrigger> {
    // Find agent node IDs from output connections
    if (outputNodeIds.size === 0) {
      throw new NotFoundException(
        'AGENT_NOT_FOUND',
        `No output connections found for trigger`,
      );
    }

    // Get the first output node ID (should be an agent)
    const agentNodeId = Array.from(outputNodeIds)[0]!;

    // Create a new ManualTrigger instance
    const manualTrigger = await this.moduleRef.resolve(
      ManualTrigger,
      undefined,
      {
        strict: false,
      },
    );

    // Set the agent invocation function
    manualTrigger.setInvokeAgent(
      async (
        messages: HumanMessage[],
        runnableConfig: RunnableConfig<BaseAgentConfigurable>,
      ) => {
        // Look up the agent from the registry at runtime to get the current instance
        const currentAgentNode = this.graphRegistry.getNode<SimpleAgent>(
          metadata.graphId,
          agentNodeId,
        );

        if (!currentAgentNode) {
          throw new NotFoundException(
            'AGENT_NOT_FOUND',
            `Agent node ${agentNodeId} not found in graph ${metadata.graphId}`,
          );
        }

        const agent = currentAgentNode.instance;

        const threadId = `${metadata.graphId}:${runnableConfig.configurable?.thread_id || v4()}`;
        const checkpointNs = `${threadId}:${agentNodeId}`;

        // The threadId at trigger level becomes the parent_thread_id for all agents in this execution
        const parentThreadId = threadId;

        // Enrich runnableConfig with graph and node metadata
        const enrichedConfig: RunnableConfig<BaseAgentConfigurable> = {
          ...runnableConfig,
          configurable: {
            ...runnableConfig.configurable,
            graph_id: metadata.graphId,
            node_id: agentNodeId,
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            parent_thread_id: parentThreadId,
            source: `${this.name} (${this.kind})`,
          },
        };

        const promise = agent.runOrAppend(
          threadId,
          messages,
          undefined,
          enrichedConfig,
        );

        // Support async execution: if configurable.async is true, fire-and-forget
        if (runnableConfig.configurable?.async) {
          void promise.catch((err) => {
            this.logger.error(err);
          });

          return {
            messages: [],
            threadId,
            checkpointNs,
          };
        }

        return await promise;
      },
    );

    // Start the trigger
    await manualTrigger.start();

    return manualTrigger;
  }
}
