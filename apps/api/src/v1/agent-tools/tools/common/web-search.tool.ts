import { Injectable } from '@nestjs/common';
import { tavily } from '@tavily/core';
import { z } from 'zod';

import { BaseTool } from '../base-tool';

export const WebSearchToolSchema = z.object({
  purpose: z
    .string()
    .min(1)
    .describe('Brief reason for using this tool. Keep it short (< 120 chars).'),
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

export type WebSearchToolConfig = { apiKey: string };

@Injectable()
export class WebSearchTool extends BaseTool<
  WebSearchToolSchemaType,
  WebSearchToolConfig,
  WebSearchOutput
> {
  public name = 'web_search';
  public description =
    'Search the web for up-to-date information and return top results. For deeper results set searchDepth="advanced".';

  public get schema() {
    return WebSearchToolSchema;
  }

  public async invoke(
    args: WebSearchToolSchemaType,
    config: WebSearchToolConfig,
  ): Promise<WebSearchOutput> {
    const client = tavily({ apiKey: config.apiKey });
    // Extract purpose from args before passing to search client
    const { purpose: _purpose, query, ...opts } = args;

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
