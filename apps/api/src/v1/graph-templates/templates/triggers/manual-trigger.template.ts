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
import { CompiledGraphNode } from '../../../graphs/graphs.types';
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
export const ManualTriggerTemplateSchema = z.object({
  agentId: z.string().min(1),
  threadId: z.string().optional(),
});

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

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly logger: DefaultLogger,
  ) {
    super();
  }

  async create(
    config: ManualTriggerTemplateSchemaType,
    compiledNodes: Map<string, CompiledGraphNode>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<ManualTrigger> {
    // Get the target agent node
    const agentNode = compiledNodes.get(config.agentId) as
      | CompiledGraphNode<
          SimpleAgentTemplateResult<SimpleAgentTemplateSchemaType>
        >
      | undefined;

    if (!agentNode) {
      throw new NotFoundException(
        'AGENT_NOT_FOUND',
        `Agent ${config.agentId} not found for trigger`,
      );
    }

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

    this.logger.debug('manual-trigger-template.create', {
      agentId: config.agentId,
      threadId: config.threadId,
    });

    // Set the agent invocation function
    manualTrigger.setInvokeAgent(
      async (
        messages: HumanMessage[],
        runnableConfig: RunnableConfig<BaseAgentConfigurable>,
      ) => {
        const threadId = runnableConfig.configurable?.thread_id || v4();
        this.logger.debug('manual-trigger-template.invoke-agent', {
          agentId: config.agentId,
          threadId,
          messageCount: messages.length,
          metadata,
        });
        // Enrich runnableConfig with graph and node metadata
        const enrichedConfig: RunnableConfig<BaseAgentConfigurable> = {
          ...runnableConfig,
          configurable: {
            ...runnableConfig.configurable,
            graph_id: metadata.graphId,
            node_id: metadata.nodeId,
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
