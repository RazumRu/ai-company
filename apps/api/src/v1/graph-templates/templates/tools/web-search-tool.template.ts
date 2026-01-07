import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';

import { BuiltAgentTool } from '../../../agent-tools/tools/base-tool';
import { WebSearchTool } from '../../../agent-tools/tools/common/web-search.tool';
import { GraphNode, NodeKind } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { ToolNodeBaseTemplate } from '../base-node.template';

export const WebSearchToolTemplateSchema = z
  .object({
    apiKey: z.string().min(1).describe('Tavily API key to authorize searches'),
  })
  // Strip legacy/unknown fields so older configs remain valid.
  .strip();

@Injectable()
@RegisterTemplate()
export class WebSearchToolTemplate extends ToolNodeBaseTemplate<
  typeof WebSearchToolTemplateSchema
> {
  readonly id = 'web-search-tool';
  readonly name = 'Web search';
  readonly description = 'Search the web for information';
  readonly schema = WebSearchToolTemplateSchema;

  readonly inputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  public async create() {
    const webSearchTool: WebSearchTool = await this.createNewInstance(
      this.moduleRef,
      WebSearchTool,
    );

    return {
      provide: async (
        _params: GraphNode<z.infer<typeof WebSearchToolTemplateSchema>>,
      ) => {
        return { tools: [] };
      },
      configure: async (
        params: GraphNode<z.infer<typeof WebSearchToolTemplateSchema>>,
        instance: { tools: BuiltAgentTool[]; instructions?: string },
      ) => {
        instance.tools.length = 0;
        instance.tools.push(await webSearchTool.build(params.config));
        instance.instructions = undefined; // No group instructions for single tool
      },
      destroy: async (instance: { tools: BuiltAgentTool[] }) => {
        instance.tools.length = 0;
      },
    };
  }
}
