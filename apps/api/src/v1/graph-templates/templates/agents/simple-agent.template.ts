import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { compact } from 'lodash';
import { z } from 'zod';

import { AgentFactoryService } from '../../../agents/services/agent-factory.service';
import {
  SimpleAgent,
  SimpleAgentSchema,
  SimpleAgentSchemaType,
} from '../../../agents/services/agents/simple-agent';
import { CompiledGraphNode } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  SimpleAgentNodeBaseTemplate,
  SimpleAgentTemplateResult,
} from '../base-node.template';

export const SimpleAgentTemplateSchema = SimpleAgentSchema.extend({
  toolNodeIds: z.array(z.string()).optional(),
});

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
  readonly description = 'Simple agent with configurable tools and runtime';
  readonly schema = SimpleAgentTemplateSchema;

  constructor(private readonly agentFactoryService: AgentFactoryService) {
    super();
  }

  async create(
    config: SimpleAgentTemplateSchemaType,
    compiledNodes: Map<string, CompiledGraphNode>,
  ): Promise<SimpleAgentTemplateResult<SimpleAgentSchemaType>> {
    const agent = await this.agentFactoryService.create(SimpleAgent);
    const { toolNodeIds = [], ...agentConfig } = config;

    const tools = compact<CompiledGraphNode<DynamicStructuredTool>>(
      toolNodeIds.map(
        (id) =>
          compiledNodes.get(id) as CompiledGraphNode<DynamicStructuredTool>,
      ),
    );

    for (const t of tools) {
      agent.addTool(t.instance);
    }

    return {
      agent,
      config: agentConfig,
    };
  }
}
