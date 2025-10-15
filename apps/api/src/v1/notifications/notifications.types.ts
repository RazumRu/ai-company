import { BaseMessage } from '@langchain/core/messages';

import { GraphSchemaType } from '../graphs/graphs.types';

export enum NotificationEvent {
  Graph = 'graph.update',
  Checkpointer = 'graph.checkpointer.update',
}

export interface INotification<T> {
  type: NotificationEvent;
  data: T;
  graphId: string;
  nodeId?: string;
  threadId?: string;
}

export interface IGraphNotification
  extends INotification<{
    state: 'compiling' | 'compiled' | 'destroyed';
    schema: GraphSchemaType;
  }> {
  type: NotificationEvent.Graph;
}

export interface ICheckpointerData {
  messages: BaseMessage[];
}

export interface ICheckpointerNotification
  extends INotification<ICheckpointerData> {
  type: NotificationEvent.Checkpointer;
  nodeId: string;
  threadId: string;
}

export type Notification = IGraphNotification | ICheckpointerNotification;
