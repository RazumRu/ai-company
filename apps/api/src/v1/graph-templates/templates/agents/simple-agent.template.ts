import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AgentFactoryService } from '../../../agents/services/agent-factory.service';
import {
  SimpleAgent,
  SimpleAgentSchema,
} from '../../../agents/services/agents/simple-agent';
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
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
  readonly name = 'simple-agent';
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

  constructor(private readonly agentFactoryService: AgentFactoryService) {
    super();
  }

  async create(
    config: SimpleAgentTemplateSchemaType,
    _inputNodes: Map<string, CompiledGraphNode>,
    outputNodes: Map<string, CompiledGraphNode>,
    _metadata: NodeBaseTemplateMetadata,
  ): Promise<SimpleAgent> {
    const agent = await this.agentFactoryService.create(SimpleAgent);
    const { ...agentConfig } = config;

    // Set initial configuration
    agent.setConfig(agentConfig);

    for (const [_nodeId, node] of outputNodes) {
      if (node.type === NodeKind.Tool) {
        agent.addTool(
          (node as CompiledGraphNode<DynamicStructuredTool>).instance,
        );
      }
    }

    return agent;
  }
}
