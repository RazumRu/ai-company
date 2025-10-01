import { DynamicStructuredTool } from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { z } from 'zod';

export abstract class BaseTool<TConfig extends Record<PropertyKey, any>> {
  public abstract name: string;
  public abstract description: string;
  public system = false;

  public abstract get schema(): z.ZodType<any>;

  public abstract build(config?: TConfig): DynamicStructuredTool;

  protected buildToolConfiguration(config?: LangGraphRunnableConfig) {
    return {
      name: this.name,
      description: this.description,
      schema: this.schema,
      ...config,
    };
  }
}
