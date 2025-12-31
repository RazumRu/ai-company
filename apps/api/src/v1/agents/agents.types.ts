import { BaseMessage } from '@langchain/core/messages';

export type BaseAgentStateMessagesUpdateValue = {
  mode: 'append' | 'replace';
  items: BaseMessage[];
};

export interface BaseAgentState {
  messages: BaseMessage[];
  /**
   * Running conversation summary (memory).
   * Important: this is state only; it must not be stored as a synthetic message in `messages`.
   */
  summary: string;
  /**
   * Per-tool metadata/state, keyed by tool name.
   * Tools can update only their own entry via ToolInvokeResult.stateChange.
   */
  toolsMetadata: Record<string, Record<string, unknown>>;
  toolUsageGuardActivated: boolean;
  toolUsageGuardActivatedCount: number;
  /**
   * Aggregated token usage for this thread/run.
   * These counters are part of the persisted graph checkpoint state so
   * ThreadsService can read them without re-summing messages.
   */
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  totalPrice: number;
  /**
   * Current context size (tokens) for this thread/run snapshot.
   * Not additive; overwritten with latest measurement.
   */
  currentContext: number;
}

export interface BaseAgentStateChange extends Partial<
  Omit<BaseAgentState, 'messages'>
> {
  messages?: BaseAgentStateMessagesUpdateValue;
}

export enum NewMessageMode {
  InjectAfterToolCall = 'inject_after_tool_call',
  WaitForCompletion = 'wait_for_completion',
}

export enum ReasoningEffort {
  None = 'none',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}
