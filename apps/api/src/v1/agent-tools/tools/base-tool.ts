import { BaseMessage } from '@langchain/core/messages';
import {
  DynamicStructuredTool,
  tool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { ZodSchema } from 'zod';

import type { MessageAdditionalKwargs } from '../../agents/agents.types';
import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import type { RequestTokenUsage } from '../../litellm/litellm.types';
import { zodToAjvSchema } from '../agent-tools.utils';

// NOTE: Zod v4's `z.toJSONSchema` is overloaded (schema vs registry), so
// `ReturnType<typeof z.toJSONSchema>` resolves to the registry overload.
// We only use the *schema* overload and pass the produced JSON schema to Ajv,
// so we keep this type as a generic "JSON schema-like object".
export type JSONSchema = Record<string, unknown>;

export type ExtendedLangGraphRunnableConfig = LangGraphRunnableConfig & {
  description?: string;
};

/**
 * A streaming tool invocation yields BaseMessage[] chunks for real-time delivery,
 * and returns ToolInvokeResult when complete.
 */
export type ToolInvokeStream<TResult> = AsyncGenerator<
  BaseMessage[],
  ToolInvokeResult<TResult>,
  undefined
>;

export type BuiltAgentTool = DynamicStructuredTool & {
  __instructions?: string;
  __titleFromArgs?: (args: unknown) => string | undefined;
  /**
   * Pre-computed AJV-compatible JSON Schema for this tool's arguments.
   * Avoids re-converting from Zod at runtime (which can fail for MCP tools
   * whose Zod schemas contain transforms produced by jsonSchemaToZod).
   */
  __ajvSchema?: JSONSchema;
  /**
   * Optional streaming invoke handler. When present, ToolExecutorNode calls this
   * directly (bypassing LangChain's DynamicStructuredTool.invoke) to consume
   * streamed messages in real-time.
   */
  __streamingInvoke?: (
    args: unknown,
    config: ToolRunnableConfig<BaseAgentConfigurable>,
    toolMetadata?: unknown,
  ) => ToolInvokeStream<unknown>;
};

export type ToolInvokeResult<TResult> = {
  output: TResult;
  messageMetadata?: MessageAdditionalKwargs;
  /**
   * Optional tool-owned state update persisted into agent state by ToolExecutorNode.
   * This is stored under `state.toolsMetadata[tool.name]`.
   */
  stateChange?: unknown;
  /**
   * Optional extra messages to append to the agent state.
   * These will be persisted alongside tool result messages.
   */
  additionalMessages?: BaseMessage[];
  /**
   * Optional LLM token usage incurred by this tool during execution.
   * If provided, will be added to thread state usage counters and
   * attached to the tool message entity.
   */
  toolRequestUsage?: RequestTokenUsage;
};

export abstract class BaseTool<TSchema, TConfig = unknown, TResult = unknown> {
  public abstract name: string;
  public abstract description: string;

  protected generateTitle?(args: TSchema, config: TConfig): string;

  public getDetailedInstructions?(
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string;

  /**
   * Returns the Zod schema for this tool's arguments.
   *
   * @example
   * ```ts
   * public get schema() {
   *   return MyToolSchema;
   * }
   * ```
   */
  public abstract get schema(): ZodSchema;

  /**
   * Returns the JSON Schema (AJV-compatible) for this tool's arguments.
   * This is automatically derived from the Zod schema.
   */
  public get ajvSchema(): JSONSchema {
    return zodToAjvSchema(this.schema);
  }

  /**
   * Validates arguments against the Zod schema.
   */
  public validate(args: unknown): TSchema {
    return this.schema.parse(args) as TSchema;
  }

  protected buildToolConfiguration(config?: ExtendedLangGraphRunnableConfig) {
    return {
      name: this.name,
      description: config?.description || this.description,
      schema: this.schema,
      ...config,
    };
  }

  public abstract invoke(
    args: TSchema,
    config: TConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
    /**
     * Current tool metadata for this tool only (i.e. `state.toolsMetadata[tool.name]`).
     * Optional for backward compatibility and because tools may be stateless.
     */
    toolMetadata?: unknown,
  ): Promise<ToolInvokeResult<TResult>> | ToolInvokeResult<TResult>;

  /**
   * Optional streaming invoke handler. Override this to yield intermediate
   * BaseMessage[] chunks for real-time delivery while the tool is executing.
   * The generator must return a ToolInvokeResult when done.
   *
   * ToolExecutorNode will call this (via __streamingInvoke on the built tool)
   * instead of invoke() when present.
   */
  public streamingInvoke?(
    args: TSchema,
    config: TConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
    toolMetadata?: unknown,
  ): ToolInvokeStream<TResult>;

  public build(
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): BuiltAgentTool {
    const builtTool = this.toolWrapper(
      this.invoke.bind(this),
      config,
      lgConfig,
    );

    const instructions = this.getDetailedInstructions
      ? this.getDetailedInstructions(config, lgConfig)
      : undefined;

    const titleFromArgs = this.generateTitle
      ? (args: unknown) => {
          try {
            const parsed = this.validate(args);
            return this.generateTitle?.(parsed, config);
          } catch {
            return undefined;
          }
        }
      : undefined;

    const streamingInvoke = this.streamingInvoke
      ? (
          args: unknown,
          runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
          toolMetadata?: unknown,
        ) => {
          const parsed = this.validate(args);
          return this.streamingInvoke!(
            parsed,
            config,
            runnableConfig,
            toolMetadata,
          );
        }
      : undefined;

    return Object.assign(builtTool, {
      __instructions: instructions,
      __titleFromArgs: titleFromArgs,
      __ajvSchema: this.ajvSchema,
      ...(streamingInvoke ? { __streamingInvoke: streamingInvoke } : {}),
    }) as BuiltAgentTool;
  }

  protected toolWrapper(
    cb: typeof this.invoke,
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): DynamicStructuredTool {
    return tool(async (args, runnableConfig) => {
      const parsedArgs = this.validate(args);

      const toolMetadata = (
        runnableConfig as ToolRunnableConfig<BaseAgentConfigurable>
      )?.configurable?.toolMetadata;

      return cb(
        parsedArgs,
        config,
        runnableConfig as ToolRunnableConfig<BaseAgentConfigurable>,
        toolMetadata,
      );
    }, this.buildToolConfiguration(lgConfig)) as DynamicStructuredTool;
  }
}
