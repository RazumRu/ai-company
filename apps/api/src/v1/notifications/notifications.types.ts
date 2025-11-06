import { BaseMessage } from '@langchain/core/messages';

import {
  GraphExecutionMetadata,
  GraphNodeStatus,
  GraphSchemaType,
  GraphStatus,
} from '../graphs/graphs.types';
import { ThreadEntity } from '../threads/entity/thread.entity';
import { ThreadStatus } from '../threads/threads.types';

export enum NotificationEvent {
  Graph = 'graph.update',
  AgentMessage = 'agent.message',
  AgentInvoke = 'agent.invoke',
  AgentStateUpdate = 'agent.state.update',
  ThreadCreate = 'thread.create',
  ThreadUpdate = 'thread.update',
  GraphNodeUpdate = 'graph.node.update',
}

export interface INotification<T> {
  type: NotificationEvent;
  data: T;
  graphId: string;
  nodeId?: string;
  threadId?: string;
  parentThreadId?: string;
  runId?: string;
}

export interface IGraphNotification
  extends INotification<{
    status: GraphStatus;
    schema?: GraphSchemaType;
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

export interface IThreadCreateNotification extends INotification<ThreadEntity> {
  type: NotificationEvent.ThreadCreate;
  threadId: string;
  parentThreadId?: string;
  internalThreadId: string;
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

export interface IGraphNodeUpdateData {
  status: GraphNodeStatus;
  error?: string | null;
  metadata?: GraphExecutionMetadata;
}

export interface IGraphNodeUpdateNotification
  extends INotification<IGraphNodeUpdateData> {
  type: NotificationEvent.GraphNodeUpdate;
  nodeId: string;
}

export type Notification =
  | IGraphNotification
  | IAgentMessageNotification
  | IAgentInvokeNotification
  | IAgentStateUpdateNotification
  | IThreadCreateNotification
  | IThreadUpdateNotification
  | IGraphNodeUpdateNotification;
