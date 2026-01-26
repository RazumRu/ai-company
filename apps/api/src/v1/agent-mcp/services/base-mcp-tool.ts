import { ToolRunnableConfig } from '@langchain/core/tools';
import type { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';
import { ZodSchema } from 'zod';

import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../agent-tools/tools/base-tool';
import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { McpToolMetadata } from './base-mcp';

type CallToolHandler = (
  toolName: string,
  args: Record<string, unknown>,
  cfg: ToolRunnableConfig<BaseAgentConfigurable>,
) => Promise<unknown>;

export class BaseMcpTool<TSchema, TConfig = unknown> extends BaseTool<
  TSchema,
  TConfig
> {
  public name = '';
  public description = '';

  public get schema() {
    // MCP tools already provide JSON schemas
    return this.tool.inputSchema as unknown as ZodSchema;
  }

  constructor(
    private readonly tool: ListToolsResult['tools'][number],
    private readonly callTool: CallToolHandler,
    private readonly metadata: McpToolMetadata | undefined,
  ) {
    super();

    this.name = tool.name;
    this.description = tool.description || '';
  }

  protected override generateTitle(args: unknown, _config: TConfig): string {
    return (
      this.metadata?.generateTitle?.(args as Record<string, unknown>) || ''
    );
  }

  public getDetailedInstructions(
    _config: TConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ) {
    return this.metadata?.getDetailedInstructions?.() || '';
  }

  public async invoke(
    data: TSchema,
    config: TConfig,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<string>> {
    const title = this.generateTitle(data, config);

    try {
      const result = await this.callTool(
        this.tool.name,
        data as Record<string, unknown>,
        cfg,
      );

      // Extract text content from CallToolResult
      let output = 'No result returned';
      if (
        result &&
        typeof result === 'object' &&
        'content' in result &&
        Array.isArray((result as { content?: unknown }).content)
      ) {
        const content = (
          result as { content: { type?: string; text?: string }[] }
        ).content;
        const textContent = content
          .filter(
            (item: { type?: string }): item is { type: 'text'; text: string } =>
              item.type === 'text',
          )
          .map((item) => item.text || '')
          .join('\n');
        output = textContent || JSON.stringify(content);
      }

      return {
        output,
        messageMetadata: {
          __title: title,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        output: `Error executing MCP tool: ${errorMessage}`,
        messageMetadata: {
          __title: title,
        },
      };
    }
  }
}
