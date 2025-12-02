import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AgentFactoryService } from '../../../agents/services/agent-factory.service';
import {
  SimpleAgent,
  SimpleAgentSchema,
} from '../../../agents/services/agents/simple-agent';
import { NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  SimpleAgentNodeBaseTemplate,
} from '../base-node.template';

export const SimpleAgentTemplateSchema = SimpleAgentSchema;

export type SimpleAgentTemplateSchemaType = z.infer<
  typeof SimpleAgentTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class SimpleAgentTemplate extends SimpleAgentNodeBaseTemplate<
  typeof SimpleAgentTemplateSchema,
  SimpleAgent
> {
  readonly id = 'simple-agent';
  readonly name = 'Simple agent';
  readonly description =
    'Configurable agent that can use connected tools and triggers';
  readonly schema = SimpleAgentTemplateSchema;

  readonly inputs = [
    {
      type: 'template',
      value: 'agent-communication-tool',
      multiple: true,
    },
    {
      type: 'kind',
      value: NodeKind.Trigger,
      multiple: true,
    },
  ] as const;

  readonly outputs = [
    {
      type: 'kind',
      value: NodeKind.Tool,
      multiple: true,
    },
  ] as const;

  constructor(
    private readonly agentFactoryService: AgentFactoryService,
    private readonly graphRegistry: GraphRegistry,
  ) {
    super();
  }

  async create(
    config: SimpleAgentTemplateSchemaType,
    _inputNodeIds: Set<string>,
    outputNodeIds: Set<string>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<SimpleAgent> {
    const agent = await this.agentFactoryService.create(SimpleAgent);
    const { ...agentConfig } = config;

    // Set initial configuration
    agent.setConfig(agentConfig);

    // Look up tool nodes from the registry and add them to the agent
    for (const nodeId of outputNodeIds) {
      const node = this.graphRegistry.getNode<DynamicStructuredTool[]>(
        metadata.graphId,
        nodeId,
      );

      if (node && node.type === NodeKind.Tool) {
        agent.addTool(node.instance);
      }
    }

    return agent;
  }
}
