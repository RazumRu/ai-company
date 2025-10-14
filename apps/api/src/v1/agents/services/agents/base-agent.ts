import { BaseMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatOpenAI, OpenAIChatModelId } from '@langchain/openai';
import { z } from 'zod';

import { environment } from '../../../../environments';
import { BaseAgentConfigurable } from '../nodes/base-node';

export type AgentOutput = {
  messages: BaseMessage[];
  threadId: string;
  checkpointNs?: string;
};

export abstract class BaseAgent<TSchema> {
  protected tools: DynamicStructuredTool[] = [];

  public addTool(tool: DynamicStructuredTool) {
    this.tools.push(tool);
  }

  public abstract get schema(): z.ZodType<TSchema>;

  public buildLLM(model: OpenAIChatModelId): ChatOpenAI {
    const llm = new ChatOpenAI({
      model,
      apiKey: environment.litellmMasterKey,
      configuration: { baseURL: environment.llmBaseUrl },
    });

    return llm;
  }

  public abstract run(
    threadId: string,
    messages: BaseMessage[],
    config: z.infer<TSchema>,
    runnableConfig?: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<AgentOutput>;
}
