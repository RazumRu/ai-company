import type { BaseMessage } from '@langchain/core/messages';

import type { TriggerNodeInfoType } from '../graphs/dto/graphs.dto';
import { GraphRevisionEntity } from '../graphs/entity/graph-revision.entity';
import {
  GraphExecutionMetadata,
  GraphNodeStatus,
  GraphSchemaType,
  GraphStatus,
} from '../graphs/graphs.types';
import { ThreadDto } from '../threads/dto/threads.dto';
import { ThreadEntity } from '../threads/entity/thread.entity';
import { ThreadStatus } from '../threads/threads.types';

export enum NotificationEvent {
  Graph = 'graph.update',
  AgentMessage = 'agent.message',
  AgentInvoke = 'agent.invoke',
  AgentStateUpdate = 'agent.state.update',
  ThreadCreate = 'thread.create',
  ThreadUpdate = 'thread.update',
  ThreadDelete = 'thread.delete',
  GraphNodeUpdate = 'graph.node.update',
  GraphRevisionCreate = 'graph.revision.create',
  GraphRevisionApplying = 'graph.revision.applying',
  GraphRevisionApplied = 'graph.revision.applied',
  GraphRevisionFailed = 'graph.revision.failed',
  GraphRevisionProgress = 'graph.revision.progress',
  RuntimeStatus = 'runtime.status',
  GraphPreview = 'graph.preview',
}

export interface INotification<T> {
  type: NotificationEvent;
  data: T;
  graphId: string;
  projectId?: string;
  nodeId?: string;
  threadId?: string;
  parentThreadId?: string;
  runId?: string;
}

export interface IGraphNotification extends INotification<{
  status: GraphStatus;
  schema?: GraphSchemaType;
}> {
  type: NotificationEvent.Graph;
}

export interface IAgentMessageData {
  messages: BaseMessage[];
}

export interface IAgentMessageNotification extends INotification<IAgentMessageData> {
  type: NotificationEvent.AgentMessage;
  nodeId: string;
  threadId: string;
  parentThreadId: string;
}

export interface IAgentInvokeData {
  messages: BaseMessage[];
}

export interface IAgentInvokeNotification extends INotification<IAgentInvokeData> {
  type: NotificationEvent.AgentInvoke;
  nodeId: string;
  threadId: string;
  parentThreadId: string;
  source?: string;
  threadMetadata?: Record<string, unknown>;
}

export interface IAgentStateUpdateData {
  summary?: string;
  done?: boolean;
  needsMoreInfo?: boolean;
  toolUsageGuardActivated?: boolean;
  toolUsageGuardActivatedCount?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  totalPrice?: number;
  currentContext?: number;
}

export interface IAgentStateUpdateNotification extends INotification<IAgentStateUpdateData> {
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
  scheduledResumeAt?: string;
  waitReason?: string;
}

export type ThreadUpdateNotificationData = IThreadUpdateData | ThreadDto;

export interface IThreadUpdateNotification extends INotification<ThreadUpdateNotificationData> {
  type: NotificationEvent.ThreadUpdate;
  nodeId?: string;
  threadId: string;
  parentThreadId?: string;
}

export interface IThreadDeleteNotification extends INotification<ThreadEntity> {
  type: NotificationEvent.ThreadDelete;
  threadId: string;
  internalThreadId: string;
}

export interface IGraphNodeUpdateData {
  status: GraphNodeStatus;
  error?: string | null;
  metadata?: GraphExecutionMetadata;
  additionalNodeMetadata?: Record<string, unknown>;
}

export interface IGraphNodeUpdateNotification extends INotification<IGraphNodeUpdateData> {
  type: NotificationEvent.GraphNodeUpdate;
  nodeId: string;
}

export interface IGraphRevisionNotification extends INotification<GraphRevisionEntity> {
  type:
    | NotificationEvent.GraphRevisionCreate
    | NotificationEvent.GraphRevisionApplying
    | NotificationEvent.GraphRevisionApplied
    | NotificationEvent.GraphRevisionFailed;
}

export interface IGraphRevisionProgressData {
  revisionId: string;
  graphId: string;
  toVersion: string;
  currentNode: number;
  totalNodes: number;
  nodeId: string;
  phase: 'rebuilding' | 'completed';
}

export interface IGraphRevisionProgressNotification extends INotification<IGraphRevisionProgressData> {
  type: NotificationEvent.GraphRevisionProgress;
}

export interface IRuntimeStatusData {
  runtimeId: string;
  threadId: string;
  nodeId: string;
  status: 'Starting' | 'Running' | 'Stopping' | 'Stopped' | 'Failed';
  runtimeType: string;
  message?: string;
}

export interface IRuntimeStatusNotification extends INotification<IRuntimeStatusData> {
  type: NotificationEvent.RuntimeStatus;
}

export interface GraphPreviewPayload {
  id: string;
  status: string;
  triggerNodes: TriggerNodeInfoType[];
  nodeDisplayNames: Record<string, string>;
  nodeCount: number;
  edgeCount: number;
  agents: { nodeId: string; name: string; description?: string }[];
  version: string;
  targetVersion: string;
  error?: string | null;
}

export interface IGraphPreviewNotification extends INotification<GraphPreviewPayload> {
  type: NotificationEvent.GraphPreview;
}

export type Notification =
  | IGraphNotification
  | IAgentMessageNotification
  | IAgentInvokeNotification
  | IAgentStateUpdateNotification
  | IThreadCreateNotification
  | IThreadUpdateNotification
  | IThreadDeleteNotification
  | IGraphNodeUpdateNotification
  | IGraphRevisionNotification
  | IGraphRevisionProgressNotification
  | IRuntimeStatusNotification
  | IGraphPreviewNotification;
