import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AgentFactoryService } from '../../../agents/services/agent-factory.service';
import {
  SimpleAgent,
  SimpleAgentSchema,
  SimpleAgentSchemaType,
} from '../../../agents/services/agents/simple-agent';
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  SimpleAgentNodeBaseTemplate,
  SimpleAgentTemplateResult,
} from '../base-node.template';

export const SimpleAgentTemplateSchema = SimpleAgentSchema.extend({}).strict();

export type SimpleAgentTemplateSchemaType = z.infer<
  typeof SimpleAgentTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class SimpleAgentTemplate extends SimpleAgentNodeBaseTemplate<
  typeof SimpleAgentTemplateSchema,
  SimpleAgentTemplateResult<SimpleAgentSchemaType>
> {
  readonly name = 'simple-agent';
  readonly description =
    'Configurable agent that can use connected tools and triggers';
  readonly schema = SimpleAgentTemplateSchema;

  readonly inputs = [
    {
      type: 'kind',
      value: NodeKind.Tool,
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
      type: 'template',
      value: 'agent-communication-tool',
      multiple: true,
    },
  ] as const;

  constructor(private readonly agentFactoryService: AgentFactoryService) {
    super();
  }

  async create(
    config: SimpleAgentTemplateSchemaType,
    inputNodes: Map<string, CompiledGraphNode>,
    _outputNodes: Map<string, CompiledGraphNode>,
    _metadata: NodeBaseTemplateMetadata,
  ): Promise<SimpleAgentTemplateResult<SimpleAgentSchemaType>> {
    const agent = await this.agentFactoryService.create(SimpleAgent);
    const { ...agentConfig } = config;

    for (const [_nodeId, node] of inputNodes) {
      if (node.type === NodeKind.Tool) {
        agent.addTool(
          (node as CompiledGraphNode<DynamicStructuredTool>).instance,
        );
      }
    }

    return {
      agent,
      config: agentConfig,
    };
  }
}
