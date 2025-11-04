import { BaseMessage } from '@langchain/core/messages';

import { GraphSchemaType } from '../graphs/graphs.types';
import { ThreadStatus } from '../threads/threads.types';

export enum NotificationEvent {
  Graph = 'graph.update',
  AgentMessage = 'agent.message',
  AgentInvoke = 'agent.invoke',
  AgentStateUpdate = 'agent.state.update',
  ThreadUpdate = 'thread.update',
}

export interface INotification<T> {
  type: NotificationEvent;
  data: T;
  graphId: string;
  nodeId?: string;
  threadId?: string;
  parentThreadId?: string;
}

export interface IGraphNotification
  extends INotification<{
    state: 'compiling' | 'compiled' | 'destroyed';
    schema: GraphSchemaType;
  }> {
  type: NotificationEvent.Graph;
}

export interface IAgentMessageData {
  messages: BaseMessage[];
}

export interface IAgentMessageNotification
  extends INotification<IAgentMessageData> {
  type: NotificationEvent.AgentMessage;
  nodeId: string;
  threadId: string;
  parentThreadId: string;
}

export interface IAgentInvokeData {
  messages: BaseMessage[];
}

export interface IAgentInvokeNotification
  extends INotification<IAgentInvokeData> {
  type: NotificationEvent.AgentInvoke;
  nodeId: string;
  threadId: string;
  parentThreadId: string;
  source?: string;
}

export interface IAgentStateUpdateData {
  generatedTitle?: string;
  summary?: string;
  done?: boolean;
  needsMoreInfo?: boolean;
  toolUsageGuardActivated?: boolean;
  toolUsageGuardActivatedCount?: number;
}

export interface IAgentStateUpdateNotification
  extends INotification<IAgentStateUpdateData> {
  type: NotificationEvent.AgentStateUpdate;
  nodeId: string;
  threadId: string;
  parentThreadId: string;
}

export interface IThreadUpdateData {
  status?: ThreadStatus;
  name?: string;
}

export interface IThreadUpdateNotification
  extends INotification<IThreadUpdateData> {
  type: NotificationEvent.ThreadUpdate;
  nodeId?: string;
  threadId: string;
  parentThreadId?: string;
}

export type Notification =
  | IGraphNotification
  | IAgentMessageNotification
  | IAgentInvokeNotification
  | IAgentStateUpdateNotification
  | IThreadUpdateNotification;
