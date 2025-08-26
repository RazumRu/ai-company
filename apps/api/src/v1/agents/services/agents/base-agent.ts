import { BaseMessage, SystemMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { MemorySaver } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';
import { v4 } from 'uuid';
import { z } from 'zod';

import { environment } from '../../../../environments';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { getShellTool } from '../../tools/shell.tool';
import { getWebSearchTool } from '../../tools/web-search.tool';

type AgentOutput<S extends Record<PropertyKey, any>> = {
  messages: BaseMessage[];
  structuredResponse?: S;
};

export abstract class BaseAgent {
  private agent?: ReturnType<typeof createReactAgent>;
  private llm?: ChatOpenAI;
  private memorySaver = new MemorySaver();
  private agentId = v4();

  constructor(
    public runtime: BaseRuntime,
    protected readonly modelName: string,
    public readonly agentName: string,
    protected schema?: z.ZodObject<any>,
  ) {}

  public abstract instructions(): string;
  protected getAdditionalTools?(): DynamicStructuredTool[];

  public setRuntime(runtime: BaseRuntime) {
    this.runtime = runtime;
  }

  public setSchema(schema: z.ZodObject<any>) {
    this.schema = schema;
  }

  public getLLM(): ChatOpenAI {
    if (!this.llm) {
      this.llm = new ChatOpenAI({
        model: this.modelName,
        apiKey: environment.litellmMasterKey,
        configuration: { baseURL: environment.llmBaseUrl },
      });
    }

    return this.llm;
  }

  public getAgent(): ReturnType<typeof createReactAgent> {
    if (!this.agent) {
      this.agent = createReactAgent({
        tools: this.tools,
        llm: this.getLLM(),
        checkpointSaver: this.memorySaver,
        responseFormat: this.schema,
      });
    }

    return this.agent;
  }

  public async run<S extends Record<PropertyKey, any>>(
    messages: BaseMessage[],
    config?: RunnableConfig,
  ): Promise<AgentOutput<S>> {
    const agent = this.getAgent();

    const mergedConfig: RunnableConfig = {
      ...(config ?? {}),
      configurable: {
        thread_id: this.agentId,
        ...(config?.configurable ?? {}),
      },
    };

    const state = await agent.getState(mergedConfig);
    if (!state.values?.messages) {
      messages = [
        new SystemMessage({
          content: this.instructions(),
          name: this.agentName,
        }),
        ...messages,
      ];
    }

    return (await agent.invoke(
      {
        messages,
      },
      mergedConfig,
    )) as AgentOutput<S>;
  }

  async completeStructured<T extends z.ZodObject<any>>(
    messages: BaseMessage[],
    schema: T,
    config?: RunnableConfig,
  ): Promise<z.infer<T>> {
    const llm = this.getLLM().withStructuredOutput<z.infer<T>>(schema, {
      method: 'json_schema',
      name: 'FinalOutput',
    });

    const out = await llm.invoke(messages, config);

    return out;
  }

  public get tools(): DynamicStructuredTool[] {
    return [
      getShellTool(this.runtime),
      getWebSearchTool(this.runtime),
      ...(this.getAdditionalTools?.() || []),
    ];
  }
}
