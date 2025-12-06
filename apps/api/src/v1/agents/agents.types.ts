import { BaseMessage } from '@langchain/core/messages';

export type BaseAgentStateMessagesUpdateValue = {
  mode: 'append' | 'replace';
  items: BaseMessage[];
};

export interface BaseAgentState {
  messages: BaseMessage[];
  summary: string;
  done: boolean;
  needsMoreInfo: boolean;
  toolUsageGuardActivated: boolean;
  toolUsageGuardActivatedCount: number;
  generatedTitle?: string;
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
