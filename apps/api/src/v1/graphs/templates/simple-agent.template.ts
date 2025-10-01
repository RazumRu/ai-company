import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { compact } from 'lodash';
import { z } from 'zod';

import {
  SimpleAgent,
  SimpleAgentSchema,
} from '../../agents/services/agents/simple-agent';
import { CompiledGraphNode } from '../graphs.types';
import { SimpleAgentNodeBaseTemplate } from './base-node.template';

export const SimpleAgentTemplateSchema = SimpleAgentSchema.extend(
  z.object({
    toolNodeIds: z.array(z.string()).optional(),
  }).shape,
);

@Injectable()
export class SimpleAgentTemplate extends SimpleAgentNodeBaseTemplate<
  typeof SimpleAgentTemplateSchema
> {
  readonly name = 'simple-agent';
  readonly description = 'Simple agent with configurable tools and runtime';
  readonly schema = SimpleAgentTemplateSchema;

  constructor(private moduleRef: ModuleRef) {
    super();
  }

  async create(
    config: z.infer<typeof SimpleAgentTemplateSchema>,
    compiledNodes: Map<string, CompiledGraphNode>,
  ): Promise<SimpleAgent> {
    const agent = await this.moduleRef.resolve(SimpleAgent);
    const tools = compact<CompiledGraphNode<DynamicStructuredTool>>(
      (config.toolNodeIds || []).map(
        (id) =>
          compiledNodes.get(id) as CompiledGraphNode<DynamicStructuredTool>,
      ),
    );

    for (const t of tools) {
      agent.addTool(t.instance);
    }

    return agent;
  }
}
