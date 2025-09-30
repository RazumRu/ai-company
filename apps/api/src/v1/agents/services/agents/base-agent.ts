import { BaseMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph';
import { ChatOpenAI, OpenAIChatModelId } from '@langchain/openai';
import { z } from 'zod';

import { environment } from '../../../../environments';

export type AgentOutput = {
  messages: BaseMessage[];
};

export abstract class BaseAgent<TSchema extends z.ZodTypeAny> {
  public abstract get tools(): DynamicStructuredTool[];
  public abstract get schema(): TSchema;

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
    runnableConfig?: RunnableConfig,
  ): Promise<AgentOutput>;
}
