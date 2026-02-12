import { BaseMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { Annotation, BaseChannel } from '@langchain/langgraph';
import {
  ChatOpenAI,
  ChatOpenAIFields,
  OpenAIChatModelId,
} from '@langchain/openai';
import { EventEmitter } from 'events';

import { environment } from '../../../../environments';
import { GraphExecutionMetadata } from '../../../graphs/graphs.types';
import { RequestTokenUsage } from '../../../litellm/litellm.types';
import {
  BaseAgentState,
  BaseAgentStateChange,
  BaseAgentStateMessagesUpdateValue,
} from '../../agents.types';
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
  protected tools: Map<string, DynamicStructuredTool> = new Map();
  protected eventEmitter = new EventEmitter();

  public addTool(tool: DynamicStructuredTool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Reset (clear) the agent toolset.
   */
  public resetTools(): void {
    this.tools.clear();
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
   * Emit agent events.
   * Public so that subagent event forwarding can re-emit through the parent.
   */
  public emit(event: AgentEventType): void {
    this.eventEmitter.emit('event', event);
  }

  public buildLLM(
    model: OpenAIChatModelId,
    params?: ChatOpenAIFields,
  ): ChatOpenAI {
    return new ChatOpenAI({
      model,
      apiKey: environment.litellmMasterKey,
      configuration: { baseURL: environment.llmBaseUrl },
      tags: ['ai-company'],
      ...params,
    });
  }

  public getGraphNodeMetadata(
    _meta: GraphExecutionMetadata,
  ): TNodeMetadata | undefined {
    return undefined;
  }

  public abstract run(
    threadId: string,
    messages: BaseMessage[],
    config?: TSchema,
    runnableConfig?: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<AgentOutput>;

  /**
   * Build the LangGraph Annotation state schema for BaseAgentState.
   * Shared across SimpleAgent and SubAgent to avoid duplication.
   */
  protected buildState() {
    return Annotation.Root({
      messages: Annotation<BaseMessage[], BaseAgentStateMessagesUpdateValue>({
        reducer: (left, right) =>
          !right
            ? left
            : right.mode === 'append'
              ? [...left, ...right.items]
              : right.items,
        default: () => [],
      }),
      summary: Annotation<string, string>({
        reducer: (left, right) => (right !== undefined ? right : left),
        default: () => '',
      }),
      toolsMetadata: Annotation<
        Record<string, Record<string, unknown>>,
        Record<string, Record<string, unknown>>
      >({
        reducer: (left, right) => (right ? { ...left, ...right } : left),
        default: () => ({}),
      }),
      toolUsageGuardActivatedCount: Annotation<number, number>({
        reducer: (left, right) => right ?? left,
        default: () => 0,
      }),
      toolUsageGuardActivated: Annotation<boolean, boolean>({
        reducer: (left, right) => right ?? left,
        default: () => false,
      }),
      inputTokens: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      cachedInputTokens: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      outputTokens: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      reasoningTokens: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      totalTokens: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      totalPrice: Annotation<number, number>({
        reducer: (left, right) => left + (right ?? 0),
        default: () => 0,
      }),
      currentContext: Annotation<number, number>({
        reducer: (left, right) => right ?? left,
        default: () => 0,
      }),
    } satisfies Record<
      keyof BaseAgentState,
      BaseChannel | (() => BaseChannel)
    >);
  }

  /**
   * Apply a partial state change to the current agent state, producing the next state.
   * Shared across SimpleAgent and SubAgent.
   */
  protected applyChange(
    prev: BaseAgentState,
    change: BaseAgentStateChange,
  ): BaseAgentState {
    const nextMessages = change.messages
      ? change.messages.mode === 'append'
        ? [...prev.messages, ...change.messages.items]
        : change.messages.items
      : prev.messages;

    return {
      messages: nextMessages,
      summary: change.summary ?? prev.summary,
      toolsMetadata: change.toolsMetadata
        ? { ...prev.toolsMetadata, ...change.toolsMetadata }
        : prev.toolsMetadata,
      toolUsageGuardActivated:
        change.toolUsageGuardActivated ?? prev.toolUsageGuardActivated,
      toolUsageGuardActivatedCount:
        change.toolUsageGuardActivatedCount ??
        prev.toolUsageGuardActivatedCount,
      inputTokens: prev.inputTokens + (change.inputTokens ?? 0),
      cachedInputTokens:
        prev.cachedInputTokens + (change.cachedInputTokens ?? 0),
      outputTokens: prev.outputTokens + (change.outputTokens ?? 0),
      reasoningTokens: prev.reasoningTokens + (change.reasoningTokens ?? 0),
      totalTokens: prev.totalTokens + (change.totalTokens ?? 0),
      totalPrice: prev.totalPrice + (change.totalPrice ?? 0),
      currentContext: change.currentContext ?? prev.currentContext,
    };
  }

  /**
   * Extract aggregated token usage from agent state.
   * Returns null when no tokens were consumed.
   */
  protected extractUsageFromState(
    state: BaseAgentState,
  ): RequestTokenUsage | null {
    const hasAny =
      state.inputTokens !== 0 ||
      state.cachedInputTokens !== 0 ||
      state.outputTokens !== 0 ||
      state.reasoningTokens !== 0 ||
      state.totalTokens !== 0 ||
      state.totalPrice !== 0 ||
      state.currentContext !== 0;

    if (!hasAny) return null;

    return {
      inputTokens: state.inputTokens,
      ...(state.cachedInputTokens
        ? { cachedInputTokens: state.cachedInputTokens }
        : {}),
      outputTokens: state.outputTokens,
      ...(state.reasoningTokens
        ? { reasoningTokens: state.reasoningTokens }
        : {}),
      totalTokens: state.totalTokens,
      ...(state.totalPrice ? { totalPrice: state.totalPrice } : {}),
      ...(state.currentContext ? { currentContext: state.currentContext } : {}),
    };
  }

  public abstract stop(): Promise<void>;

  /**
   * Update the agent's configuration without destroying the instance.
   * This allows tools that hold references to the agent to continue working with the updated config.
   */
  public abstract setConfig(config: TSchema): void;

  /**
   * Get the current agent configuration (including enhanced instructions)
   */
  public abstract getConfig(): TSchema;
}
