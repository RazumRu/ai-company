import type { ToolRunnableConfig } from '@langchain/core/tools';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { z } from 'zod';

import { BuiltAgentTool } from '../../agent-tools/tools/base-tool';
import type { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { RuntimeStartParams, RuntimeType } from '../../runtime/runtime.types';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { RuntimeProvider } from '../../runtime/services/runtime-provider';
import { RuntimeThreadProvider } from '../../runtime/services/runtime-thread-provider';
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
  protected runtimeThreadProvider?: RuntimeThreadProvider;
  protected logger: DefaultLogger;
  public config?: TConfig;
  private cachedTools?: BuiltAgentTool[];
  private readonly clients = new Map<string, Client>();
  private readonly clientRuntimes = new Map<string, BaseRuntime>();
  private registeredJobId?: string;
  private executorNodeId?: string;

  constructor(logger: DefaultLogger) {
    this.logger = logger;
  }

  protected getRuntimeInstance(): RuntimeThreadProvider | undefined {
    return this.runtimeThreadProvider;
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
   * Returns the initialization timeout in milliseconds
   * Override this method in subclasses to customize timeout per MCP
   * Default: 5 minutes (300000ms) - suitable for Docker image pulls
   */
  protected getInitTimeoutMs(): number {
    return 300_000;
  }

  /**
   * Setup: Initialize SDK client with DockerExecTransport
   * Runs MCP server command inside the connected Docker runtime
   */
  public async setup(config: TConfig, runtime: BaseRuntime): Promise<Client> {
    this.config = config;
    const mcpConfig = this.getMcpConfig(config);

    // Initialize transport using DockerRuntime.execStream
    const transport = new DockerExecTransport(
      () => runtime,
      mcpConfig.command,
      mcpConfig.args,
      mcpConfig.env || {},
      this.logger,
    );

    const client = new Client(
      {
        name: mcpConfig.name,
        version: '1.0.0',
      },
      {
        capabilities: {},
      },
    );

    await this.connectWithTimeout(client, transport, this.getInitTimeoutMs());
    return client;
  }

  /**
   * Connect client with timeout
   */
  private async connectWithTimeout(
    client: Client,
    transport: DockerExecTransport,
    timeoutMs: number,
  ): Promise<void> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `MCP initialization timed out after ${timeoutMs / 1000} seconds`,
          ),
        );
      }, timeoutMs);
    });

    try {
      await Promise.race([
        client.connect(transport, {
          timeout: timeoutMs,
        }),
        timeoutPromise,
      ]);
    } catch (error) {
      // Cleanup client on timeout or connection error
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  public async initialize(
    config: TConfig,
    runtimeThreadProvider: RuntimeThreadProvider,
    runtime: BaseRuntime,
    executorNodeId: string,
  ): Promise<void> {
    this.config = config;
    this.runtimeThreadProvider = runtimeThreadProvider;
    this.executorNodeId = executorNodeId;
    this.registerRuntimeInitJob();

    const client = await this.setup(config, runtime);
    const tools = await this.listTools(client);
    this.cachedTools = tools;
    await client.close().catch(() => undefined);
  }

  public async provideTemporaryRuntime(params: {
    runtimeProvider: RuntimeProvider;
    graphId: string;
    runtimeNodeId: string;
    runtimeConfig: RuntimeStartParams & { runtimeType: RuntimeType };
  }): Promise<BaseRuntime> {
    const { runtimeType, ...runtimeStartParams } = params.runtimeConfig;
    const { runtime } = await params.runtimeProvider.provide({
      graphId: params.graphId,
      runtimeNodeId: params.runtimeNodeId,
      threadId: `mcp-init-${params.graphId}-${params.runtimeNodeId}`,
      type: runtimeType,
      runtimeStartParams,
      temporary: true,
    });

    return runtime;
  }

  private registerRuntimeInitJob(): void {
    if (!this.runtimeThreadProvider || !this.config) {
      return;
    }
    if (!this.executorNodeId) {
      return;
    }
    if (this.registeredJobId) {
      return;
    }

    const jobId = `mcp-init:${this.getMcpConfig(this.config).name}`;
    this.registeredJobId = jobId;

    this.runtimeThreadProvider.registerJob(
      this.executorNodeId,
      jobId,
      async (runtime, cfg) => {
        const threadId = this.getThreadId(cfg);
        await this.ensureClient(threadId, runtime);
      },
    );
  }

  private async listTools(client: Client): Promise<BuiltAgentTool[]> {
    const result = await client.listTools();
    let tools = result.tools;

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
      >(mcpTool, this.callTool.bind(this), toolMetadata);
      const builtAgentTool = toolInstance.build(this.config || ({} as TConfig));
      builtTools.push(builtAgentTool);
    }

    return builtTools;
  }

  /**
   * Discover available tools from the MCP server
   * Filters tools based on toolsMapping if defined
   */
  public async discoverTools(): Promise<BuiltAgentTool[]> {
    if (this.cachedTools) {
      return this.cachedTools;
    }
    throw new Error('MCP tools not initialized. Call initialize() first');
  }

  public async callTool(
    toolName: string,
    args: Record<string, unknown>,
    cfg: ToolRunnableConfig<BaseAgentConfigurable>,
  ) {
    if (!this.runtimeThreadProvider) {
      throw new Error('Runtime provider not initialized for MCP');
    }
    if (!this.config) {
      throw new Error('MCP config not initialized');
    }

    const threadId = this.getThreadId(cfg);
    const runtime = await this.runtimeThreadProvider.provide(cfg);
    const client = await this.ensureClient(threadId, runtime);
    return client.callTool({
      name: toolName,
      arguments: args,
    });
  }

  private async ensureClient(
    threadId: string,
    runtime: BaseRuntime,
  ): Promise<Client> {
    const existing = this.clients.get(threadId);
    const existingRuntime = this.clientRuntimes.get(threadId);
    if (existing && existingRuntime === runtime) {
      return existing;
    }

    if (existing) {
      await existing.close().catch(() => undefined);
    }

    const client = await this.setup(this.config as TConfig, runtime);
    this.clients.set(threadId, client);
    this.clientRuntimes.set(threadId, runtime);
    return client;
  }

  private getThreadId(cfg: ToolRunnableConfig<BaseAgentConfigurable>): string {
    const threadId =
      cfg.configurable?.parent_thread_id || cfg.configurable?.thread_id;
    if (!threadId) {
      throw new Error('Thread id is required for MCP execution');
    }
    return threadId;
  }

  /**
   * Explicit cleanup - called by GraphCompiler on graph destruction
   * NOT called by NestJS lifecycle (TRANSIENT services don't get onModuleDestroy reliably)
   */
  public async cleanup(): Promise<void> {
    const clients = Array.from(this.clients.values());
    this.clients.clear();
    this.clientRuntimes.clear();
    this.cachedTools = undefined;

    await Promise.all(
      clients.map(async (client) => {
        try {
          await client.close();
        } catch (error) {
          this.logger.error(
            error instanceof Error ? error : new Error(String(error)),
            'Error closing MCP client',
          );
        }
      }),
    );

    if (this.runtimeThreadProvider && this.executorNodeId) {
      this.runtimeThreadProvider.removeExecutor(this.executorNodeId);
    }
  }

  /**
   * Optional: Provide detailed instructions for this MCP
   */
  public getDetailedInstructions?(config: TConfig): string;
}
