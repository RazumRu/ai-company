import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { z } from 'zod';

import { BuiltAgentTool } from '../../agent-tools/tools/base-tool';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { IMcpServerConfig } from '../agent-mcp.types';
import { BaseMcpTool } from './base-mcp-tool';
import { DockerExecTransport } from './docker-exec-transport';

/**
 * Configuration for a mapped MCP tool
 */
export interface McpToolMetadata {
  /** Optional: Detailed instructions for this specific tool */
  getDetailedInstructions?: () => string;
  /** Optional: Generate a dynamic title for tool execution based on arguments */
  generateTitle?: (args: Record<string, unknown>) => string;
}

/**
 * Base class for all MCP implementations
 * Lifecycle: setup() → discoverTools() → execute() → cleanup()
 * Cleanup is called explicitly by GraphCompiler, not by NestJS lifecycle
 */
@Injectable()
export abstract class BaseMcp<TConfig = unknown> {
  protected client?: Client;
  protected runtime?: BaseRuntime;
  protected logger: DefaultLogger;
  public config?: TConfig;

  constructor(logger: DefaultLogger) {
    this.logger = logger;
  }

  protected getRuntimeInstance(): BaseRuntime | undefined {
    return this.runtime;
  }

  /**
   * Optional: Define a mapping of tools to expose with additional metadata.
   * If defined, only tools in this mapping will be exposed.
   * If not defined, all tools from the MCP server will be exposed.
   *
   * @returns Array of tool mappings with optional metadata, or undefined to expose all tools
   */
  protected toolsMapping?(): Map<string, McpToolMetadata> | undefined;

  /**
   * Returns MCP server configuration (command, args, env)
   */
  public abstract getMcpConfig(config: TConfig): IMcpServerConfig;

  /**
   * Setup: Initialize SDK client with DockerExecTransport
   * Runs MCP server command inside the connected Docker runtime
   */
  public async setup(config: TConfig, runtime: BaseRuntime): Promise<void> {
    this.runtime = runtime;
    this.config = config;
    const mcpConfig = this.getMcpConfig(config);

    // Initialize transport using DockerRuntime.execStream
    const transport = new DockerExecTransport(
      () => {
        if (!this.runtime) {
          throw new Error('Runtime not available');
        }
        return this.runtime;
      },
      mcpConfig.command,
      mcpConfig.args,
      mcpConfig.env || {},
      this.logger,
    );

    this.client = new Client(
      {
        name: mcpConfig.name,
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    await this.client.connect(transport);
  }

  /**
   * Discover available tools from the MCP server
   * Filters tools based on toolsMapping if defined
   */
  public async discoverTools(): Promise<BuiltAgentTool[]> {
    if (!this.client) {
      throw new Error('MCP client not initialized. Call setup() first');
    }

    const result = await this.client.listTools();
    let tools = result.tools;

    // Apply filtering if toolsMapping is defined
    const mapping: Map<string, McpToolMetadata> =
      this.toolsMapping?.() || new Map<string, McpToolMetadata>();
    if (mapping && mapping.size > 0) {
      tools = tools.filter((tool) => mapping.has(tool.name));
    }

    const builtTools: BuiltAgentTool[] = [];

    for (const mcpTool of tools) {
      const toolMetadata = mapping.get(mcpTool.name);

      const toolInstance = new BaseMcpTool<
        z.infer<typeof mcpTool.inputSchema>,
        TConfig
      >(mcpTool, this.client, toolMetadata);

      // Use the stored config, falling back to empty object if not set
      const builtAgentTool = toolInstance.build(this.config || ({} as TConfig));

      builtTools.push(builtAgentTool);
    }

    return builtTools;
  }

  /**
   * Explicit cleanup - called by GraphCompiler on graph destruction
   * NOT called by NestJS lifecycle (TRANSIENT services don't get onModuleDestroy reliably)
   */
  public async cleanup(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        // Log but don't throw - cleanup should be resilient
        this.logger.error(
          error instanceof Error ? error : new Error(String(error)),
          'Error closing MCP client',
        );
      }
      this.client = undefined;
    }
  }

  /**
   * Optional: Provide detailed instructions for this MCP
   */
  public getDetailedInstructions?(config: TConfig): string;
}
