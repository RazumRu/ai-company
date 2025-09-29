import { BaseMessage } from '@langchain/core/messages';

import { RuntimeType } from '../runtime/runtime.types';

export interface PrepareRuntimeParams {
  runtimeType?: RuntimeType;
  runtimeImage?: string;
  workdir?: string;
}

export type BaseAgentStateMessagesUpdateValue = {
  mode: 'append' | 'replace';
  items: BaseMessage[];
};

export interface BaseAgentState {
  messages: BaseMessage[];
  summary: string;
  done: boolean;
  toolUsageGuardActivated: boolean;
  toolUsageGuardActivatedCount: number;
}

export interface BaseAgentStateChange
  extends Partial<Omit<BaseAgentState, 'messages'>> {
  messages?: BaseAgentStateMessagesUpdateValue;
}
