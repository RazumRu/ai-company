import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { compact } from 'lodash';
import { z } from 'zod';

import {
  SimpleAgent,
  SimpleAgentSchema,
  SimpleAgentSchemaType,
} from '../../agents/services/agents/simple-agent';
import { CompiledGraphNode } from '../graphs.types';
import {
  SimpleAgentNodeBaseTemplate,
  SimpleAgentTemplateResult,
} from './base-node.template';

export const SimpleAgentTemplateSchema = SimpleAgentSchema.extend(
  z.object({
    toolNodeIds: z.array(z.string()).optional(),
  }).shape,
);

export type SimpleAgentTemplateSchemaType = z.infer<
  typeof SimpleAgentTemplateSchema
>;

@Injectable()
export class SimpleAgentTemplate extends SimpleAgentNodeBaseTemplate<
  typeof SimpleAgentTemplateSchema,
  SimpleAgentTemplateResult<SimpleAgentSchemaType>
> {
  readonly name = 'simple-agent';
  readonly description = 'Simple agent with configurable tools and runtime';
  readonly schema = SimpleAgentTemplateSchema;

  constructor(private moduleRef: ModuleRef) {
    super();
  }

  async create(
    config: SimpleAgentTemplateSchemaType,
    compiledNodes: Map<string, CompiledGraphNode>,
  ): Promise<SimpleAgentTemplateResult<SimpleAgentSchemaType>> {
    const agent = await this.moduleRef.resolve(SimpleAgent);
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
