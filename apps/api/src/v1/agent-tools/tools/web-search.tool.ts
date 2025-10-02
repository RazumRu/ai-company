import { Injectable } from '@nestjs/common';
import { tavily } from '@tavily/core';
import { z } from 'zod';

import { environment } from '../../../environments';
import { BaseTool } from './base-tool';

export const WebSearchToolSchema = z.object({
  query: z.string().min(1),
  searchDepth: z.enum(['basic', 'advanced']).default('basic'),
  includeDomains: z.array(z.string()).optional(),
  excludeDomains: z.array(z.string()).optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
});
export type WebSearchToolSchemaType = z.infer<typeof WebSearchToolSchema>;

type WebSearchOutput = {
  answer?: string | null;
  results: { title: string; url: string; content: string }[];
};

@Injectable()
export class WebSearchTool extends BaseTool<
  WebSearchToolSchemaType,
  unknown,
  WebSearchOutput
> {
  public name = 'web-search';
  public description =
    'Search the web for up-to-date information and return top results. For deeper results set searchDepth="advanced".';

  public get schema() {
    return WebSearchToolSchema;
  }

  public async invoke(args: WebSearchToolSchemaType): Promise<WebSearchOutput> {
    const client = tavily({ apiKey: environment.tavilyApiKey });
    const { query, ...opts } = args;

    const res = await client.search(query, opts);

    return {
      answer: res.answer ?? null,
      results: (res.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
      })),
    };
  }
}
