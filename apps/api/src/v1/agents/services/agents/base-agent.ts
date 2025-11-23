import { BaseMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import {
  ChatOpenAI,
  ChatOpenAIFields,
  OpenAIChatModelId,
} from '@langchain/openai';
import { EventEmitter } from 'events';
import { z } from 'zod';

import { environment } from '../../../../environments';
import { GraphExecutionMetadata } from '../../../graphs/graphs.types';
import { BaseAgentConfigurable } from '../nodes/base-node';

export type AgentOutput = {
  messages: BaseMessage[];
  threadId: string;
  checkpointNs?: string;
  needsMoreInfo?: boolean;
};

export type AgentRunEvent = {
  threadId: string;
  messages: BaseMessage[];
  config: RunnableConfig<BaseAgentConfigurable>;
  result?: AgentOutput;
  error?: unknown;
};

export type AgentStopEvent = {
  config: RunnableConfig<BaseAgentConfigurable>;
  error?: unknown;
  threadId: string;
};

export type AgentInvokeEvent = {
  threadId: string;
  messages: BaseMessage[];
  config: RunnableConfig<BaseAgentConfigurable>;
};

export type AgentMessageEvent = {
  threadId: string;
  messages: BaseMessage[];
  config: RunnableConfig<BaseAgentConfigurable>;
};

export type AgentStateUpdateEvent = {
  threadId: string;
  stateChange: Record<string, unknown>;
  config: RunnableConfig<BaseAgentConfigurable>;
};

export type AgentNodeAdditionalMetadataUpdateEvent = {
  metadata: GraphExecutionMetadata;
  additionalMetadata?: Record<string, unknown>;
};

export type AgentEventType =
  | { type: 'run'; data: AgentRunEvent }
  | { type: 'stop'; data: AgentStopEvent }
  | { type: 'invoke'; data: AgentInvokeEvent }
  | { type: 'message'; data: AgentMessageEvent }
  | { type: 'stateUpdate'; data: AgentStateUpdateEvent }
  | {
      type: 'nodeAdditionalMetadataUpdate';
      data: AgentNodeAdditionalMetadataUpdateEvent;
    };

export abstract class BaseAgent<
  TSchema = unknown,
  TNodeMetadata = Record<string, unknown>,
> {
  protected tools: DynamicStructuredTool[] = [];
  protected eventEmitter = new EventEmitter();

  public addTool(tool: DynamicStructuredTool) {
    this.tools.push(tool);
  }

  /**
   * Subscribe to agent events
   * Returns an unsubscriber function
   */
  subscribe(callback: (event: AgentEventType) => Promise<void>): () => void {
    const handler = (event: AgentEventType) => callback(event);

    this.eventEmitter.on('event', handler);

    return () => {
      this.eventEmitter.off('event', handler);
    };
  }

  /**
   * Emit agent events
   */
  protected emit(event: AgentEventType): void {
    this.eventEmitter.emit('event', event);
  }

  public abstract get schema(): z.ZodType<TSchema>;

  public buildLLM(
    model: OpenAIChatModelId,
    params?: ChatOpenAIFields,
  ): ChatOpenAI {
    const llm = new ChatOpenAI({
      model,
      apiKey: environment.litellmMasterKey,
      configuration: { baseURL: environment.llmBaseUrl },
      useResponsesApi: true,
      ...params,
    });

    return llm;
  }

  public getGraphNodeMetadata(
    _meta: GraphExecutionMetadata,
  ): TNodeMetadata | undefined {
    return undefined;
  }

  public abstract run(
    threadId: string,
    messages: BaseMessage[],
    config?: z.infer<TSchema>,
    runnableConfig?: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<AgentOutput>;

  public abstract stop(): Promise<void>;

  /**
   * Update the agent's configuration without destroying the instance.
   * This allows tools that hold references to the agent to continue working with the updated config.
   */
  public abstract setConfig(config: z.infer<TSchema>): void;
}
