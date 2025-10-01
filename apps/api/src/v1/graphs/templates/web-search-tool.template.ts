import { DynamicStructuredTool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { WebSearchTool } from '../../agent-tools/tools/web-search.tool';
import { ToolNodeBaseTemplate } from './base-node.template';

export const WebSearchToolSchema = z.object({});

@Injectable()
export class WebSearchToolTemplate extends ToolNodeBaseTemplate<
  typeof WebSearchToolSchema
> {
  readonly name = 'web-search-tool';
  readonly description = 'Web search tool';
  readonly schema = WebSearchToolSchema;

  constructor(private readonly webSearchTool: WebSearchTool) {
    super();
  }

  async create(
    config: z.infer<typeof WebSearchToolSchema>,
  ): Promise<DynamicStructuredTool> {
    return this.webSearchTool.build(config);
  }
}
