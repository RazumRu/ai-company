import { GraphRevisionEntity } from '../graphs/entity/graph-revision.entity';
import {
  GraphExecutionMetadata,
  GraphNodeStatus,
  GraphSchemaType,
  GraphStatus,
} from '../graphs/graphs.types';
import type { MessageTokenUsage } from '../litellm/litellm.types';
import { ThreadDto } from '../threads/dto/threads.dto';
import { ThreadEntity } from '../threads/entity/thread.entity';
import { ThreadStatus } from '../threads/threads.types';

/**
 * Minimal, JSON-serializable message shape that we persist through BullMQ.
 * Keep this interface focused on fields we actually need downstream:
 * - message type (for DTO transformation / thread name generation)
 * - content
 * - tool metadata (for tool messages and AI tool calls)
 * - usage/response metadata + additional_kwargs (for tokenUsage)
 */
export interface SerializedBaseMessage {
  /**
   * Hidden marker to reliably distinguish our BullMQ-safe serialized messages.
   */
  __serialized: true;

  /**
   * LangChain message class name (e.g. HumanMessage / AIMessage / ToolMessage / SystemMessage / ChatMessage).
   */
  type: string;

  /**
   * Raw content as produced by the model/tool/user.
   */
  content?: unknown;

  /**
   * LangChain message id (optional).
   */
  id?: string;

  /**
   * Chat role (mainly for ChatMessage / reasoning).
   */
  role?: string;

  /**
   * Tool message fields.
   */
  name?: string;
  tool_call_id?: string;

  /**
   * AI tool calls as emitted by LangChain.
   */
  tool_calls?: unknown[];
  invalid_tool_calls?: unknown[];

  /**
   * Provider metadata used to compute token usage/cost.
   */
  usage_metadata?: unknown;
  response_metadata?: unknown;

  /**
   * IMPORTANT: must preserve for tokenUsage.
   */
  additional_kwargs?: MessageAdditionalKwargs;
}

export type MessageAdditionalKwargs = {
  run_id?: string;
  thread_id?: string;
  __model?: string;
  __title?: string;
  // Used by message transformer for reasoning + LLM visibility controls
  reasoningId?: string;
  hideForLlm?: boolean;
  isAgentInstructionMessage?: boolean;
  context?: unknown;
  // Per-message token usage (totalTokens + totalPrice only)
  // Full TokenUsage breakdown belongs to thread-level state, not individual messages
  tokenUsage?: MessageTokenUsage;
};

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

export interface IGraphNotification extends INotification<{
  status: GraphStatus;
  schema?: GraphSchemaType;
}> {
  type: NotificationEvent.Graph;
}

export interface IAgentMessageData {
  messages: SerializedBaseMessage[];
}

export interface IAgentMessageNotification extends INotification<IAgentMessageData> {
  type: NotificationEvent.AgentMessage;
  nodeId: string;
  threadId: string;
  parentThreadId: string;
}

export interface IAgentInvokeData {
  messages: SerializedBaseMessage[];
}

export interface IAgentInvokeNotification extends INotification<IAgentInvokeData> {
  type: NotificationEvent.AgentInvoke;
  nodeId: string;
  threadId: string;
  parentThreadId: string;
  source?: string;
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

export type Notification =
  | IGraphNotification
  | IAgentMessageNotification
  | IAgentInvokeNotification
  | IAgentStateUpdateNotification
  | IThreadCreateNotification
  | IThreadUpdateNotification
  | IThreadDeleteNotification
  | IGraphNodeUpdateNotification
  | IGraphRevisionNotification;
