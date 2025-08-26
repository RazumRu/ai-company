import { tool } from '@langchain/core/tools';
import { tavily } from '@tavily/core';
import { z } from 'zod';

import { environment } from '../../../environments';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { AgentTool } from '../agents.types';

const WebSearchParamsSchema = z.object({
  query: z.string(),
  searchDepth: z.enum(['basic', 'advanced']),
});

export const getWebSearchTool: AgentTool = (runtime?: BaseRuntime) =>
  tool(
    async (args) => {
      const data = WebSearchParamsSchema.parse(args);

      const tvly = tavily({ apiKey: environment.tavilyApiKey });
      const response = await tvly.search(data.query, data);

      return {
        answer: response.answer,
        results: response.results.map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
        })),
      };
    },
    {
      name: 'web-search',
      description:
        'Search the web for up-to-date information and return top results. For more detailed results, if needed, you can use searchDepth="advanced"',
      schema: WebSearchParamsSchema,
    },
  );
