import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable, Scope } from '@nestjs/common';
import dedent from 'dedent';
import { stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';

import type { BaseAgentConfigurable } from '../../../agents/agents.types';
import {
  BaseTool,
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
  JSONSchema,
  ToolInvokeResult,
} from '../base-tool';

export const TOOL_SEARCH_TOOL_NAME = 'tool_search' as const;

export type DeferredToolEntry = {
  tool: BuiltAgentTool;
  description: string;
  instructions?: string;
};

export type ToolSearchToolConfig = {
  deferredTools: Map<string, DeferredToolEntry>;
  loadTool: (
    name: string,
  ) => { tool: BuiltAgentTool; instructions?: string } | null;
};

export type ToolSearchOutput = {
  results: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
  message: string;
};

export const ToolSearchSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      "Search query to find and load tools by name, category, or capability. Use keywords describing what you need — e.g. 'file operations', 'github', 'shell'.",
    ),
});
export type ToolSearchSchemaType = z.infer<typeof ToolSearchSchema>;

type ScoredEntry = {
  name: string;
  entry: DeferredToolEntry;
  score: number;
};

@Injectable({ scope: Scope.TRANSIENT })
export class ToolSearchTool extends BaseTool<
  ToolSearchSchemaType,
  ToolSearchToolConfig,
  ToolSearchOutput
> {
  public static readonly TOOL_NAME = TOOL_SEARCH_TOOL_NAME;

  public name = TOOL_SEARCH_TOOL_NAME;
  public description =
    'Searches for and loads available tools by name, category, or capability keyword. Use this tool to discover what tools are available before attempting to call them. It scores candidates using an exact-name match, keyword matches in tool names, descriptions, and parameter names, then returns the top 5 results. Once a tool is found via this search, it becomes available for use in subsequent turns.';

  public getDetailedInstructions(
    _config: ToolSearchToolConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Use \`tool_search\` to discover and load tools before calling them. Not all tools are loaded upfront — you must search for them first.

      ### When to Use
      - When you need a capability but are unsure which tool provides it
      - When you want to find a tool by its name for an exact match
      - When you need to explore available tools in a category (e.g. "file", "github", "search")

      ### How It Works
      1. The \`<available-tools>\` block in the system prompt lists all available tools by name
      2. Call \`tool_search\` with a query — either an exact tool name or descriptive keywords
      3. The tool returns up to 5 matching tools with their descriptions and parameters
      4. After searching, the matched tools are loaded and available for use in subsequent turns

      ### Query Tips
      - **Exact match**: use the tool name directly (e.g. \`"shell"\`, \`"files_read"\`)
      - **Keyword search**: use descriptive terms (e.g. \`"file operations"\`, \`"git repository"\`, \`"web search"\`)
      - **Category search**: use category keywords (e.g. \`"github"\`, \`"knowledge base"\`, \`"communication"\`)

      ### Important
      - Tools must be loaded (via \`tool_search\`) before they can be called
      - If no results are returned, try different or broader keywords
      - You can call \`tool_search\` multiple times with different queries

      ### Example
      \`\`\`json
      {"query": "shell"}
      \`\`\`
      \`\`\`json
      {"query": "file read write"}
      \`\`\`
      \`\`\`json
      {"query": "github pull request"}
      \`\`\`
    `;
  }

  public get schema() {
    return ToolSearchSchema;
  }

  public invoke(
    args: ToolSearchSchemaType,
    config: ToolSearchToolConfig,
    _runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
    _toolMetadata?: unknown,
  ): ToolInvokeResult<ToolSearchOutput> {
    const queryTerms = this.tokenize(args.query);
    const scored: ScoredEntry[] = [];

    for (const [name, entry] of config.deferredTools.entries()) {
      const score = this.scoreTool(name, entry, queryTerms);
      if (score > 0) {
        scored.push({ name, entry, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const topMatches = scored.slice(0, 5);

    if (topMatches.length === 0) {
      return {
        output: {
          results: [],
          message: `No tools found matching "${args.query}". Try different or broader keywords — for example, use category names like "file", "github", "shell", "search", or "knowledge".`,
        },
      };
    }

    const loadedInstructions: string[] = [];

    const results = topMatches.map(({ name, entry }) => {
      const loaded = config.loadTool(name);

      if (loaded?.instructions) {
        loadedInstructions.push(
          `## ${name} Instructions\n${loaded.instructions}`,
        );
      }

      const ajvSchema = entry.tool.__ajvSchema;
      const parameters =
        ajvSchema && typeof ajvSchema['properties'] === 'object'
          ? (ajvSchema['properties'] as Record<string, unknown>)
          : {};

      return {
        name,
        description: entry.description,
        parameters,
      };
    });

    const yamlOutput = stringifyYaml(results);
    let message = `Found ${results.length} tool(s) matching "${args.query}":\n\n${yamlOutput}`;

    if (loadedInstructions.length > 0) {
      message += '\n\n' + loadedInstructions.join('\n\n');
    }

    return {
      output: { results, message },
    };
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().split(/\s+/).filter(Boolean);
  }

  private getSchemaPropertyNames(tool: BuiltAgentTool): string[] {
    const ajvSchema = tool.__ajvSchema as JSONSchema | undefined;
    if (!ajvSchema) {
      return [];
    }
    const properties = ajvSchema['properties'];
    if (!properties || typeof properties !== 'object') {
      return [];
    }
    return Object.keys(properties as Record<string, unknown>);
  }

  private scoreTool(
    name: string,
    entry: DeferredToolEntry,
    queryTerms: string[],
  ): number {
    const fullQuery = queryTerms.join(' ');
    const nameLower = name.toLowerCase();
    const descLower = entry.description.toLowerCase();
    const propNames = this.getSchemaPropertyNames(entry.tool);

    let score = 0;

    if (nameLower === fullQuery) {
      score += 100;
    }

    for (const term of queryTerms) {
      if (nameLower.includes(term)) {
        score += 50;
      }
      if (descLower.includes(term)) {
        score += 25;
      }
      for (const propName of propNames) {
        if (propName.toLowerCase().includes(term)) {
          score += 10;
        }
      }
    }

    return score;
  }
}
