import { BaseMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { Annotation, BaseChannel } from '@langchain/langgraph';
import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import type { LitellmService } from '../../../litellm/services/litellm.service';
import {
  BaseAgentState,
  BaseAgentStateMessagesUpdateValue,
  ReasoningEffort,
} from '../../agents.types';
import { BaseAgentConfigurable } from '../nodes/base-node';
import { AgentOutput, BaseAgent } from './base-agent';

export type SubAgentSchemaType = {
  instructions: string;
  invokeModelName: string;
  invokeModelReasoningEffort?: ReasoningEffort;
  summarizeMaxTokens?: number;
  summarizeKeepTokens?: number;
  maxIterations?: number;
};

/**
 * Lightweight LangGraph-based subagent that runs a task autonomously.
 *
 * Unlike SimpleAgent, this is ephemeral (no checkpointer, no persistence),
 * has no finish tool / tool usage guard / summarization / message injection,
 * and completes when the LLM responds without tool calls.
 *
 * Reuses InvokeLlmNode and ToolExecutorNode for consistent LLM invocation
 * and tool execution with the main agent.
 */
@Injectable()
export class SubAgent extends BaseAgent<SubAgentSchemaType> {
  private currentConfig?: SubAgentSchemaType;

  constructor(
    private readonly litellmService: LitellmService,
    private readonly logger: DefaultLogger,
  ) {
    super();
  }

  public async stop(): Promise<void> {}

  public setConfig(config: SubAgentSchemaType): void {
    this.currentConfig = config;
  }

  public getConfig(): SubAgentSchemaType {
    if (!this.currentConfig) {
      throw new Error('SubAgent config has not been set.');
    }
    return this.currentConfig;
  }

  public async run(
    _threadId: string,
    messages: BaseMessage[],
    _config?: SubAgentSchemaType,
    runnableConfig?: RunnableConfig<BaseAgentConfigurable>,
  ): Promise<AgentOutput> {
    // TODO: implement agent build and running flow and return its result
  }

  private buildState() {
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
}
