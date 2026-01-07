import { Injectable, Scope } from '@nestjs/common';
import { tavily } from '@tavily/core';
import dedent from 'dedent';
import { z } from 'zod';

import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../base-tool';

export const WebSearchToolSchema = z.object({
  searchQuery: z
    .string()
    .describe(
      'What you want to search for on the internet. Be specific and include relevant keywords.',
    )
    .min(1),
  searchDepth: z
    .enum(['basic', 'advanced'])
    .describe(
      'How deep to search: "basic" for quick results on straightforward queries, "advanced" for thorough research on complex topics',
    )
    .default('basic'),
  onlyFromDomains: z
    .array(z.string())
    .describe(
      'Only search these websites (e.g., ["stackoverflow.com", "github.com"])',
    )
    .optional(),
  skipDomains: z
    .array(z.string())
    .describe("Don't search these websites")
    .optional(),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .describe('Maximum number of results to return (1-20)')
    .optional(),
});
export type WebSearchToolSchemaType = z.infer<typeof WebSearchToolSchema>;

type WebSearchOutput = {
  answer?: string | null;
  results: { title: string; url: string; content: string }[];
};

export type WebSearchToolConfig = { apiKey: string };

@Injectable({ scope: Scope.TRANSIENT })
export class WebSearchTool extends BaseTool<
  WebSearchToolSchemaType,
  WebSearchToolConfig,
  WebSearchOutput
> {
  public name = 'web_search';
  public description =
    'Search the web for up-to-date information and return top results.';

  public getDetailedInstructions(
    _config: WebSearchToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Searches web using Tavily to find current information. Returns structured results with titles, URLs, and content snippets.

      ### When to Use
      Finding current documentation, error solutions, best practices, recent news, or information not in local codebase.

      ### When NOT to Use
      Info available in codebase → use files_search_text. For specific URL → use shell with curl/wget. For local code → use file tools.

      ### Best Practices
      Include tech versions when relevant. Include error messages verbatim. Use domain filters (onlyFromDomains) for authoritative sources. Add year for time-sensitive topics.

      ### Examples
      **1. Version-specific query:**
      \`\`\`json
      {"searchQuery": "React 18 Suspense data fetching example"}
      \`\`\`

      **2. Error search:**
      \`\`\`json
      {"searchQuery": "error TS2339: Property 'map' does not exist on type 'unknown'"}
      \`\`\`

      **3. Domain-filtered search:**
      \`\`\`json
      {"searchQuery": "PostgreSQL JSONB indexing", "onlyFromDomains": ["postgresql.org", "stackoverflow.com"]}
      \`\`\`

      **4. Deep research:**
      \`\`\`json
      {"searchQuery": "TypeScript monorepo best practices 2024", "searchDepth": "advanced", "maxResults": 10}
      \`\`\`
    `;
  }

  public get schema() {
    return z.toJSONSchema(WebSearchToolSchema, {
      target: 'draft-7',
      reused: 'ref',
    });
  }

  public async invoke(
    args: WebSearchToolSchemaType,
    config: WebSearchToolConfig,
  ): Promise<ToolInvokeResult<WebSearchOutput>> {
    const client = tavily({ apiKey: config.apiKey });
    const {
      searchQuery,
      searchDepth,
      onlyFromDomains,
      skipDomains,
      maxResults,
    } = args;

    // Map to Tavily API parameter names
    const res = await client.search(searchQuery, {
      searchDepth,
      includeDomains: onlyFromDomains,
      excludeDomains: skipDomains,
      maxResults,
    });

    const title = this.generateTitle?.(args, config);

    return {
      output: {
        answer: res.answer ?? null,
        results: (res.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          content: r.content,
        })),
      },
      messageMetadata: {
        __title: title,
      },
    };
  }

  protected override generateTitle(
    args: WebSearchToolSchemaType,
    _config: WebSearchToolConfig,
  ): string {
    return `Search in internet: ${args.searchQuery}`;
  }
}
