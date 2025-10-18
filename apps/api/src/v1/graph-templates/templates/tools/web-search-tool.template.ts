import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { WebSearchTool } from '../../../agent-tools/tools/web-search.tool';
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
  readonly description = 'Web search tool';
  readonly schema = WebSearchToolTemplateSchema;

  constructor(private readonly webSearchTool: WebSearchTool) {
    super();
  }

  async create(
    config: z.infer<typeof WebSearchToolTemplateSchema>,
    _compiledNodes: Map<string, any>,
    _metadata: NodeBaseTemplateMetadata,
  ): Promise<DynamicStructuredTool> {
    return this.webSearchTool.build(config);
  }
}
