import { ToolRunnableConfig } from '@langchain/core/tools';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ListToolsResult } from '@modelcontextprotocol/sdk/types.js';

import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  type JSONSchema,
  ToolInvokeResult,
} from '../../agent-tools/tools/base-tool';
import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { McpToolMetadata } from './base-mcp';

export class BaseMcpTool<TSchema, TConfig = unknown> extends BaseTool<
  TSchema,
  TConfig
> {
  public name = '';
  public description = '';

  public get schema() {
    // MCP tools already provide JSON schemas
    return this.tool.inputSchema as unknown as JSONSchema;
  }

  constructor(
    private readonly tool: ListToolsResult['tools'][number],
    private readonly client: Client,
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
    _cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<string>> {
    const title = this.generateTitle(data, config);

    try {
      if (!this.client) {
        throw new Error('MCP client not initialized. Call setup() first');
      }

      const result = await this.client.callTool({
        name: this.tool.name,
        arguments: data as Record<string, unknown>,
      });

      // Extract text content from CallToolResult
      let output = 'No result returned';
      if (result.content && Array.isArray(result.content)) {
        const textContent = result.content
          .filter(
            (item: { type?: string }): item is { type: 'text'; text: string } =>
              item.type === 'text',
          )
          .map((item) => item.text || '')
          .join('\n');
        output = textContent || JSON.stringify(result.content);
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
