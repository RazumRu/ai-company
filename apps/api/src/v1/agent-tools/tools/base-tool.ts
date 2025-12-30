import {
  DynamicStructuredTool,
  tool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import Ajv from 'ajv';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import {
  fixRequiredWithDefaults,
  getSchemaParameterDocs,
} from '../agent-tools.utils';

export type JSONSchema = ReturnType<typeof z.toJSONSchema>;

export type ExtendedLangGraphRunnableConfig = LangGraphRunnableConfig & {
  description?: string;
};

export type BuiltAgentTool = DynamicStructuredTool & {
  __instructions?: string;
  __titleFromArgs?: (args: unknown) => string | undefined;
};

export type ToolInvokeResult<TResult> = {
  output: TResult;
  messageMetadata?: {
    __title?: string;
  };
  /**
   * Optional tool-owned state update persisted into agent state by ToolExecutorNode.
   * This is stored under `state.toolsMetadata[tool.name]`.
   */
  stateChange?: unknown;
};

export abstract class BaseTool<TSchema, TConfig = unknown, TResult = unknown> {
  public abstract name: string;
  public abstract description: string;

  protected generateTitle?(args: TSchema, config: TConfig): string;

  private ajv = new Ajv({ useDefaults: true, coerceTypes: true });

  protected getSchemaParameterDocs(schema: JSONSchema) {
    return getSchemaParameterDocs(schema);
  }

  public getDetailedInstructions?(
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string;

  public abstract get schema(): JSONSchema;

  /**
   * Validates arguments against the JSON schema using Ajv
   * @throws Error if validation fails
   */
  public validate(args: unknown): TSchema {
    const validate = this.ajv.compile(this.schema);
    if (!validate(args)) {
      const errors = validate.errors
        ?.map((err) => `${err.instancePath} ${err.message}`)
        .join(', ');
      throw new Error(`Schema validation failed: ${errors}`);
    }
    return args as TSchema;
  }

  protected buildToolConfiguration(config?: ExtendedLangGraphRunnableConfig) {
    return {
      name: this.name,
      description: config?.description || this.description,
      schema: fixRequiredWithDefaults(this.schema) as Parameters<
        typeof tool
      >[1]['schema'],
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

    return Object.assign(builtTool, {
      __instructions: instructions,
      __titleFromArgs: titleFromArgs,
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
