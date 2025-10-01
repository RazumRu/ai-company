import { DynamicStructuredTool, tool } from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { Injectable } from '@nestjs/common';
import { tavily } from '@tavily/core';
import { z } from 'zod';

import { environment } from '../../../environments';
import { BaseTool } from './base-tool';

@Injectable()
export class WebSearchTool extends BaseTool<LangGraphRunnableConfig> {
  public name = 'web-search';
  public description =
    'Search the web for up-to-date information and return top results. For deeper results set searchDepth="advanced".';

  public get schema() {
    return z.object({
      query: z.string().min(1),
      searchDepth: z.enum(['basic', 'advanced']).default('basic'),
      includeDomains: z.array(z.string()).optional(),
      excludeDomains: z.array(z.string()).optional(),
      maxResults: z.number().int().min(1).max(20).optional(),
    });
  }

  public build(config?: LangGraphRunnableConfig): DynamicStructuredTool {
    return tool(async (args) => {
      const data = this.schema.parse(args);
      const client = tavily({
        apiKey: environment.tavilyApiKey,
      });

      const { query, ...opts } = data;
      const res = await client.search(query, opts);
      return {
        answer: res.answer,
        results: (res.results || []).map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
        })),
      };
    }, this.buildToolConfiguration(config));
  }
}
