import { DynamicStructuredTool, tool } from '@langchain/core/tools';
import { LangGraphRunnableConfig } from '@langchain/langgraph';
import { z } from 'zod';

import { BaseRuntime } from '../../runtime/services/base-runtime';
import { BaseTool } from './base-tool';

export class FinishToolResponse {
  constructor(public message?: string) {}
}

export class FinishTool extends BaseTool {
  public name = 'finish';
  public description =
    'Signal the current task is complete. Call this before ending when output is restricted.';

  public get schema() {
    return z.object({ message: z.string().optional() });
  }

  public build(config?: LangGraphRunnableConfig): DynamicStructuredTool {
    return tool(async (args) => {
      const { message } = this.schema.parse(args);

      return new FinishToolResponse(message);
    }, this.buildToolConfiguration(config));
  }
}
