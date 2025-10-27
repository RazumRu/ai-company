import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { WebSearchTool } from '../../../agent-tools/tools/web-search.tool';
import { CompiledGraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  ToolNodeBaseTemplate,
} from '../base-node.template';

export const WebSearchToolTemplateSchema = z.object({}).strict();

@Injectable()
@RegisterTemplate()
export class WebSearchToolTemplate extends ToolNodeBaseTemplate<
  typeof WebSearchToolTemplateSchema
> {
  readonly name = 'web-search-tool';
  readonly description = 'Search the web for information';
  readonly schema = WebSearchToolTemplateSchema;

  readonly inputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  constructor(private readonly webSearchTool: WebSearchTool) {
    super();
  }

  async create(
    config: z.infer<typeof WebSearchToolTemplateSchema>,
    _inputNodes: Map<string, CompiledGraphNode>,
    _outputNodes: Map<string, CompiledGraphNode>,
    _metadata: NodeBaseTemplateMetadata,
  ): Promise<DynamicStructuredTool> {
    return this.webSearchTool.build(config);
  }
}
