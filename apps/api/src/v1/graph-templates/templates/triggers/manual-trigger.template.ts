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
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { SimpleAgentTemplateSchemaType } from '../agents/simple-agent.template';
import {
  NodeBaseTemplateMetadata,
  SimpleAgentTemplateResult,
  TriggerNodeBaseTemplate,
} from '../base-node.template';

/**
 * Manual trigger template schema
 */
export const ManualTriggerTemplateSchema = z
  .object({
    threadId: z.string().optional(),
  })
  .strict();

export type ManualTriggerTemplateSchemaType = z.infer<
  typeof ManualTriggerTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class ManualTriggerTemplate extends TriggerNodeBaseTemplate<
  typeof ManualTriggerTemplateSchema,
  ManualTrigger
> {
  readonly name = 'manual-trigger';
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
  ) {
    super();
  }

  async create(
    config: ManualTriggerTemplateSchemaType,
    inputNodes: Map<string, CompiledGraphNode>,
    outputNodes: Map<string, CompiledGraphNode>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<ManualTrigger> {
    // Search for agent nodes in output nodes
    const agentNodes = Array.from(outputNodes.values()).filter(
      (node) => node.type === NodeKind.SimpleAgent,
    ) as CompiledGraphNode<
      SimpleAgentTemplateResult<SimpleAgentTemplateSchemaType>
    >[];

    if (agentNodes.length === 0) {
      throw new NotFoundException(
        'AGENT_NOT_FOUND',
        `No agent nodes found in output connections for trigger`,
      );
    }

    // Use the first agent node found
    const agentNode = agentNodes[0]!;
    const agent = agentNode.instance.agent as SimpleAgent;
    const agentConfig = agentNode.instance.config;

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
        const threadId = `${metadata.graphId}:${runnableConfig.configurable?.thread_id || v4()}`;
        const checkpointNs = `${threadId}:${agentNode.id}`;

        // Enrich runnableConfig with graph and node metadata
        const enrichedConfig: RunnableConfig<BaseAgentConfigurable> = {
          ...runnableConfig,
          configurable: {
            ...runnableConfig.configurable,
            graph_id: metadata.graphId,
            node_id: agentNode.id,
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
          },
        };

        return await agent.run(threadId, messages, agentConfig, enrichedConfig);
      },
    );

    // Start the trigger
    await manualTrigger.start();

    return manualTrigger;
  }
}
