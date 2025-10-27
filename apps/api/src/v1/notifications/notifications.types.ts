import { BaseMessage } from '@langchain/core/messages';

import { GraphSchemaType } from '../graphs/graphs.types';

export enum NotificationEvent {
  Graph = 'graph.update',
  AgentMessage = 'agent.message',
  AgentInvoke = 'agent.invoke',
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
}

export type Notification =
  | IGraphNotification
  | IAgentMessageNotification
  | IAgentInvokeNotification;
