import { BaseMessage } from '@langchain/core/messages';

import type {
  MessageTokenUsage,
  RequestTokenUsage,
} from '../litellm/litellm.types';

/**
 * Message metadata stored in `BaseMessage.additional_kwargs`.
 *
 * Conventions:
 * - Our internal/custom fields use `__` prefix.
 * - Our internal/custom fields use camelCase.
 * - Provider/tool transport fields may also be present (no enforced naming).
 */
export type MessageAdditionalKwargs = Record<string, unknown> & {
  __runId?: string;
  __threadId?: string;
  __createdAt?: string;
  __model?: string;
  __title?: string;
  /**
   * When present on an AI message, indicates this message was generated in response
   * to one or more preceding tool results (tool roundtrip).
   *
   * This is used for analytics: the requestTokenUsage for "tool usage" is recorded
   * on the AI message that processes tool results, not on the tool result messages.
   */
  __answeredToolCallNames?: string[];

  // Used by message transformer for reasoning + LLM visibility controls
  __reasoningId?: string;
  __hideForLlm?: boolean;
  __hideForSummary?: boolean;
  __isAgentInstructionMessage?: boolean;
  __isReportingMessage?: boolean;

  // Inter-agent communication metadata
  __interAgentCommunication?: boolean;
  __sourceAgentNodeId?: string;

  __context?: unknown;

  // Per-message token usage (proportional share)
  __tokenUsage?: MessageTokenUsage;

  // Full request token usage (entire LLM request, not just this message)
  __requestUsage?: RequestTokenUsage;
};

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
