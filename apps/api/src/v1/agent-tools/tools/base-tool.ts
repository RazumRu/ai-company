import {
  DynamicStructuredTool,
  tool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { getSchemaParameterDocs } from '../agent-tools.utils';

export type ExtendedLangGraphRunnableConfig = LangGraphRunnableConfig & {
  description?: string;
};

export type BuiltAgentTool = DynamicStructuredTool & {
  __instructions?: string;
};

export type ToolInvokeResult<TResult> = {
  output: TResult;
  messageMetadata?: {
    __title?: string;
  };
};

export abstract class BaseTool<TSchema, TConfig = unknown, TResult = unknown> {
  public abstract name: string;
  public abstract description: string;

  protected generateTitle?(args: TSchema, config: TConfig): string;

  protected getSchemaParameterDocs(schema: z.ZodTypeAny) {
    return getSchemaParameterDocs(schema);
  }

  public getDetailedInstructions?(
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string;

  public abstract get schema(): z.ZodType<TSchema>;

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

    return Object.assign(builtTool, { __instructions: instructions });
  }

  protected toolWrapper(
    cb: typeof this.invoke,
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ) {
    return tool(async (args, runnableConfig) => {
      const parsedArgs = this.schema.parse(args);

      return cb(
        parsedArgs as TSchema,
        config,
        runnableConfig as ToolRunnableConfig<BaseAgentConfigurable>,
      );
    }, this.buildToolConfiguration(lgConfig));
  }
}
