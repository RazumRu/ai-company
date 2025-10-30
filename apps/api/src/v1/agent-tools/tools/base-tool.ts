import {
  DynamicStructuredTool,
  tool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';

// Extended type to support description property
type ExtendedLangGraphRunnableConfig = LangGraphRunnableConfig & {
  description?: string;
};

export abstract class BaseTool<TSchema, TConfig = unknown, TResult = unknown> {
  public abstract name: string;
  public abstract description: string;
  public system = false;

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
  ): Promise<TResult> | TResult;

  public build(
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): DynamicStructuredTool {
    return this.toolWrapper(this.invoke, config, lgConfig);
  }

  protected toolWrapper(
    cb: typeof this.invoke,
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ) {
    return tool(async (args, runnableConfig) => {
      {
        const parsedArgs = this.schema.parse(args);

        return cb(
          parsedArgs as TSchema,
          config,
          runnableConfig as ToolRunnableConfig<BaseAgentConfigurable>,
        );
      }
    }, this.buildToolConfiguration(lgConfig));
  }
}
