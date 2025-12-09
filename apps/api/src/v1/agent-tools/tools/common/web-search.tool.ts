import { Injectable } from '@nestjs/common';
import { tavily } from '@tavily/core';
import dedent from 'dedent';
import { z } from 'zod';

import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../base-tool';

export const WebSearchToolSchema = z.object({
  query: z
    .string()
    .describe('The search query. Be specific and include relevant keywords.')
    .min(1),
  searchDepth: z
    .enum(['basic', 'advanced'])
    .describe(
      'Depth of search results. `basic` - Quick search for straightforward queries. `advanced` - Deeper search for complex topics',
    )
    .default('basic'),
  includeDomains: z
    .array(z.string())
    .describe('Limit search to specific domains.')
    .optional(),
  excludeDomains: z
    .array(z.string())
    .describe('Exclude specific domains from results.')
    .optional(),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(20)
    .describe('Maximum number of results to return.')
    .optional(),
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

  public getDetailedInstructions(
    _config: WebSearchToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    const parameterDocs = this.getSchemaParameterDocs(this.schema);

    return dedent`
      ### Overview
      Searches the web using Tavily search engine to find current, relevant information. Returns structured results with titles, URLs, and content snippets.

      ### When to Use
      - Finding current documentation for libraries or frameworks
      - Looking up error messages and solutions
      - Researching best practices and patterns
      - Finding recent news or updates
      - Getting information not available in local codebase

      ### When NOT to Use
      - Information is available in the codebase → use \`files_search_text\`
      - You need to access a specific URL → use shell with curl/wget
      - Looking for code in the current project → use file tools

      ${parameterDocs}
      ### Parameters

      **Avoid vague queries:**
      \`\`\`json
      {"query": "how to code"}  // Too vague
      {"query": "JavaScript"}   // Too broad
      \`\`\`

      ### Best Practices

      **1. Include technology versions when relevant:**
      \`\`\`json
      {"query": "React 18 Suspense data fetching example"}
      {"query": "Node.js 20 native fetch API usage"}
      \`\`\`

      **2. Include error messages verbatim:**
      \`\`\`json
      {"query": "error TS2339: Property 'map' does not exist on type 'unknown'"}
      \`\`\`

      **3. Use domain filters for authoritative sources:**
      \`\`\`json
      {
        "query": "PostgreSQL JSONB indexing",
        "includeDomains": ["postgresql.org", "stackoverflow.com", "github.com"]
      }
      \`\`\`

      **4. Add year for time-sensitive topics:**
      \`\`\`json
      {"query": "Next.js 14 app router conventions 2024"}
      \`\`\`

      ### Output Format
      \`\`\`json
      {
        "answer": "Brief AI-generated answer if available...",
        "results": [
          {
            "title": "React Hooks Documentation",
            "url": "https://react.dev/reference/react",
            "content": "Snippet of relevant content from the page..."
          },
          {
            "title": "Understanding useEffect",
            "url": "https://blog.example.com/use-effect",
            "content": "Another relevant snippet..."
          }
        ]
      }
      \`\`\`

      ### Common Patterns

      **Finding library documentation:**
      \`\`\`json
      {"query": "axios interceptors documentation example", "includeDomains": ["axios-http.com", "github.com"]}
      \`\`\`

      **Troubleshooting errors:**
      \`\`\`json
      {"query": "ECONNREFUSED 127.0.0.1 docker node.js", "searchDepth": "advanced"}
      \`\`\`

      **Researching best practices:**
      \`\`\`json
      {"query": "TypeScript monorepo structure best practices 2024", "searchDepth": "advanced", "maxResults": 10}
      \`\`\`

      **Finding examples:**
      \`\`\`json
      {"query": "NestJS guards example implementation", "includeDomains": ["nestjs.com", "github.com"]}
      \`\`\`

      ### Using Results
      1. Review the \`answer\` field for a quick summary
      2. Scan result titles and snippets for relevance
      3. Note URLs for reference
      4. Use shell with curl if you need full page content
      5. Apply learned information to the task at hand

      ### Rate Limiting
      Be mindful of search frequency. Batch related queries logically rather than making many small searches.
    `;
  }

  public get schema() {
    return WebSearchToolSchema;
  }

  public async invoke(
    args: WebSearchToolSchemaType,
    config: WebSearchToolConfig,
  ): Promise<ToolInvokeResult<WebSearchOutput>> {
    const client = tavily({ apiKey: config.apiKey });
    const { query, ...opts } = args;

    const res = await client.search(query, opts);

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
    return `Search in internet: ${args.query}`;
  }
}
