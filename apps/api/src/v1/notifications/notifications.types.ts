import type {
  Checkpoint,
  CheckpointMetadata,
  PendingWrite,
} from '@langchain/langgraph-checkpoint';

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

export interface ICheckpointerPutData {
  action: 'put';
  checkpoint: Checkpoint;
  metadata: CheckpointMetadata;
}

export interface ICheckpointerPutWritesData {
  action: 'putWrites';
  writes: {
    channel: string;
    value: unknown;
  }[];
}

export interface ICheckpointerNotification
  extends INotification<ICheckpointerPutData | ICheckpointerPutWritesData> {
  type: NotificationEvent.Checkpointer;
  nodeId: string;
  threadId: string;
}

export type Notification = IGraphNotification | ICheckpointerNotification;
