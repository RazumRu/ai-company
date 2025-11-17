import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger, NotFoundException } from '@packages/common';

import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { ThreadStatus } from '../../threads/threads.types';
import {
  CompiledGraphNode,
  GraphExecutionMetadata,
  GraphNodeStateSnapshot,
  GraphNodeStatus,
  NodeKind,
} from '../graphs.types';

type ExecInfo = { threadId?: string; runId?: string; startedAt: number };

interface NodeState {
  nodeId: string;
  node?: CompiledGraphNode;
  baseStatus: GraphNodeStatus;
  threadStatuses: Map<string, GraphNodeStatus>;
  runStatuses: Map<string, GraphNodeStatus>;
  error?: string | null;
  activeExecs: Map<string, ExecInfo>;
  additionalNodeMetadata?: Record<string, unknown>;
  additionalNodeMetadataByThread: Map<string, Record<string, unknown>>;
  additionalNodeMetadataByRun: Map<string, Record<string, unknown>>;
}

@Injectable({ scope: Scope.TRANSIENT })
export class GraphStateManager {
  private readonly nodes = new Map<string, NodeState>();
  private graphId = '';
  private unsubscribers: (() => void)[] = [];

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly logger: DefaultLogger,
  ) {}

  setGraphId(id: string) {
    this.graphId = id;
  }

  registerNode(nodeId: string) {
    if (this.nodes.has(nodeId)) return;
    this.nodes.set(nodeId, {
      nodeId,
      baseStatus: GraphNodeStatus.Starting,
      threadStatuses: new Map(),
      runStatuses: new Map(),
      error: null,
      activeExecs: new Map(),
      additionalNodeMetadata: undefined,
      additionalNodeMetadataByThread: new Map(),
      additionalNodeMetadataByRun: new Map(),
    });
  }

  attachGraphNode(nodeId: string, node: CompiledGraphNode) {
    const state = this.ensure(nodeId);

    state.node = node;
    state.baseStatus = GraphNodeStatus.Idle;
    this.clearError(state);

    switch (node.type) {
      case NodeKind.Runtime:
        this.attachRuntimeListeners(
          state,
          node as CompiledGraphNode<BaseRuntime>,
        );
        break;
      case NodeKind.SimpleAgent:
        this.attachAgentListeners(
          state,
          node as CompiledGraphNode<SimpleAgent>,
        );
        break;
      case NodeKind.Trigger:
        this.attachTriggerListeners(
          state,
          node as CompiledGraphNode<BaseTrigger>,
        );
        break;
    }

    this.emitNodeUpdate(state);
  }

  getNodeStatus(nodeId: string) {
    return this.ensure(nodeId).baseStatus;
  }

  getNodeThreadStatus(nodeId: string, threadId: string) {
    return this.ensure(nodeId).threadStatuses.get(threadId);
  }

  getNodeRunStatus(nodeId: string, runId: string) {
    return this.ensure(nodeId).runStatuses.get(runId);
  }

  getActiveExecList(nodeId: string) {
    const s = this.ensure(nodeId);
    return Array.from(s.activeExecs.entries()).map(([execId, v]) => ({
      execId,
      threadId: v.threadId,
      runId: v.runId,
      startedAt: v.startedAt,
    }));
  }

  getSnapshots(threadId?: string, runId?: string): GraphNodeStateSnapshot[] {
    return Array.from(this.nodes.values())
      .filter((s) => s.node)
      .map((s) => {
        const n = s.node!;
        const t = threadId ? s.threadStatuses.get(threadId) : undefined;
        const r = runId ? s.runStatuses.get(runId) : undefined;
        const status = t ?? r ?? s.baseStatus;
        const metadata = this.buildSnapshotMetadata(s, threadId, runId);
        const additionalNodeMetadata = this.buildNodeAdditionalMetadata(
          s,
          threadId,
          runId,
        );
        return {
          id: n.id,
          name: n.id,
          template: n.template,
          type: n.type,
          status,
          config: n.config,
          error: s.error ?? null,
          ...(metadata ? { metadata } : {}),
          ...(additionalNodeMetadata ? { additionalNodeMetadata } : {}),
        };
      });
  }

  destroy() {
    for (const s of this.nodes.values()) {
      s.threadStatuses.clear();
      s.runStatuses.clear();
      s.activeExecs.clear();
      s.additionalNodeMetadataByThread.clear();
      s.additionalNodeMetadataByRun.clear();
      s.additionalNodeMetadata = undefined;
      s.baseStatus = GraphNodeStatus.Stopped;
      this.clearError(s);
    }
    this.nodes.clear();

    for (const u of this.unsubscribers) {
      u();
    }
  }

  private attachRuntimeListeners(
    state: NodeState,
    node: CompiledGraphNode<BaseRuntime>,
  ) {
    const runtime = node.instance;
    const unsub = runtime.subscribe(async (event) => {
      if (event.type === 'start') {
        state.baseStatus = GraphNodeStatus.Idle;
        this.clearError(state);
        this.emitNodeUpdate(state);
      }

      if (event.type === 'stop') {
        state.threadStatuses.clear();
        state.runStatuses.clear();
        state.activeExecs.clear();

        state.baseStatus = GraphNodeStatus.Stopped;
        if (event.data.error) {
          this.setError(state, event.data.error);
        }

        this.emitNodeUpdate(state);
      }

      if (event.type === 'execStart') {
        const execId = event.data.execId;
        const meta = event.data.params.metadata as
          | GraphExecutionMetadata
          | undefined;
        const threadId = meta?.threadId;
        const runId = meta?.runId;
        state.activeExecs.set(execId, {
          threadId,
          runId,
          startedAt: Date.now(),
        });
        state.baseStatus = GraphNodeStatus.Running;

        if (threadId) {
          this.updateThreadStatus(state, threadId, GraphNodeStatus.Running);
        }

        if (runId) {
          this.updateRunStatus(state, runId, GraphNodeStatus.Running);
        }

        this.emitNodeUpdate(state);
      }

      if (event.type === 'execEnd') {
        const execId = event.data.execId;
        const info = state.activeExecs.get(execId);
        if (event.data.error) {
          this.setError(state, event.data.error);
        } else {
          this.clearError(state);
        }

        if (info?.threadId) {
          state.threadStatuses.delete(info.threadId);
        }

        if (info?.runId) {
          state.runStatuses.delete(info.runId);
        }

        state.activeExecs.delete(execId);

        if (!this.hasActive(state)) {
          state.baseStatus = GraphNodeStatus.Idle;
        }

        this.emitNodeUpdate(state);
      }
    });
    this.unsubscribers.push(unsub);
  }

  private attachAgentListeners(
    state: NodeState,
    node: CompiledGraphNode<SimpleAgent>,
  ) {
    const agent = node.instance;

    const unsub = agent.subscribe(async (event) => {
      try {
        if (event.type === 'invoke') {
          const cfg = event.data.config?.configurable;
          const graphId = cfg?.graph_id || 'unknown';
          const nodeId = cfg?.node_id || 'unknown';
          const parentThreadId = cfg?.parent_thread_id || 'unknown';
          const threadId = event.data.threadId;
          const runId = cfg?.run_id;

          // Update statuses to Running
          state.baseStatus = GraphNodeStatus.Running;

          if (threadId) {
            this.updateThreadStatus(state, threadId, GraphNodeStatus.Running);
          }

          if (runId) {
            this.updateRunStatus(state, runId, GraphNodeStatus.Running);
          }

          this.emitNodeUpdate(state);

          // Emit AgentInvoke notification
          await this.notificationsService.emit({
            type: NotificationEvent.AgentInvoke,
            graphId,
            nodeId,
            threadId: event.data.threadId,
            parentThreadId,
            source: cfg?.source,
            data: {
              messages: event.data.messages,
            },
          });
        }

        if (event.type === 'message') {
          const cfg = event.data.config?.configurable;
          const graphId = cfg?.graph_id || 'unknown';
          const nodeId = cfg?.node_id || 'unknown';
          const parentThreadId = cfg?.parent_thread_id || 'unknown';
          // Emit AgentMessage notification
          await this.notificationsService.emit({
            type: NotificationEvent.AgentMessage,
            graphId,
            nodeId,
            threadId: event.data.threadId,
            parentThreadId,
            data: {
              messages: event.data.messages,
            },
          });
        }

        if (event.type === 'stateUpdate') {
          const cfg = event.data.config?.configurable;
          const graphId = cfg?.graph_id || 'unknown';
          const nodeId = cfg?.node_id || 'unknown';
          const parentThreadId = cfg?.parent_thread_id || 'unknown';
          // Emit AgentStateUpdate notification
          await this.notificationsService.emit({
            type: NotificationEvent.AgentStateUpdate,
            graphId,
            nodeId,
            threadId: event.data.threadId,
            parentThreadId,
            data: event.data.stateChange,
          });

          // Handle thread name updates (generatedTitle)
          // Centralized place for all thread updates
          const stateChange = event.data.stateChange as Record<string, unknown>;
          if (
            stateChange.generatedTitle &&
            typeof stateChange.generatedTitle === 'string'
          ) {
            const threadId = event.data.threadId;
            const externalThreadKey = parentThreadId ?? threadId;

            await this.notificationsService.emit({
              type: NotificationEvent.ThreadUpdate,
              graphId,
              nodeId,
              threadId: externalThreadKey,
              parentThreadId,
              data: { name: stateChange.generatedTitle },
            });
          }
        }

        if (event.type === 'run') {
          const cfg = event.data.config?.configurable;
          const parentThreadId = cfg?.parent_thread_id || 'unknown';
          const threadId = event.data.threadId;
          const runId = cfg?.run_id;

          // Emit thread update notification with final status
          // Centralized place for all thread status updates on completion
          if (threadId) {
            let finalStatus: ThreadStatus;

            if (event.data.error) {
              this.setError(state, event.data.error);
              finalStatus = ThreadStatus.Stopped;
            } else {
              this.clearError(state);
              // Determine final status based on result
              finalStatus = event.data.result?.needsMoreInfo
                ? ThreadStatus.NeedMoreInfo
                : ThreadStatus.Done;
            }

            await this.notificationsService.emit({
              type: NotificationEvent.ThreadUpdate,
              graphId: this.graphId,
              nodeId: state.nodeId,
              threadId,
              parentThreadId,
              data: { status: finalStatus },
            });
          }

          // Clean up thread and run statuses
          if (threadId) {
            state.threadStatuses.delete(threadId);
          }

          if (runId) {
            state.runStatuses.delete(runId);
          }

          // Update base status based on remaining active threads/runs
          if (!this.hasActive(state)) {
            state.baseStatus = GraphNodeStatus.Idle;
          }

          this.emitNodeUpdate(state);
        }

        if (event.type === 'stop') {
          const cfg = event.data.config?.configurable;
          const parentThreadId = cfg?.parent_thread_id || 'unknown';
          // Get active threads from threadStatuses
          const activeThreadIds = Array.from(state.threadStatuses.keys());

          // Emit thread update notifications only for active threads
          for (const tid of activeThreadIds) {
            await this.notificationsService.emit({
              type: NotificationEvent.ThreadUpdate,
              graphId: this.graphId,
              nodeId: state.nodeId,
              threadId: tid,
              parentThreadId,
              data: { status: ThreadStatus.Stopped },
            });
          }

          // Clear all tracking
          state.threadStatuses.clear();
          state.runStatuses.clear();

          // Update status
          state.baseStatus = GraphNodeStatus.Stopped;

          if (event.data.error) {
            this.setError(state, event.data.error);
          }

          this.emitNodeUpdate(state);
        }

        if (event.type === 'nodeAdditionalMetadataUpdate') {
          this.updateAdditionalNodeMetadata(
            state,
            event.data.metadata,
            event.data.additionalMetadata,
          );
          this.emitNodeUpdate(
            state,
            undefined,
            event.data.metadata.threadId,
            event.data.metadata.runId,
          );
        }
      } catch (e) {
        this.logger.error(e as Error, 'Error handling agent event');
      }
    });

    this.unsubscribers.push(unsub);
  }

  private attachTriggerListeners(
    state: NodeState,
    node: CompiledGraphNode<BaseTrigger>,
  ) {
    const trigger = node.instance;

    const unsub = trigger.subscribe(async (event) => {
      try {
        if (event.type === 'start') {
          state.baseStatus = GraphNodeStatus.Idle;
          this.clearError(state);
          this.emitNodeUpdate(state);
        }

        if (event.type === 'stop') {
          state.threadStatuses.clear();
          state.runStatuses.clear();
          state.baseStatus = GraphNodeStatus.Stopped;
          if (event.data.error) {
            this.setError(state, event.data.error);
          }

          this.emitNodeUpdate(state);
        }

        if (event.type === 'invoke') {
          const cfg = event.data.config?.configurable;
          const threadId = cfg?.thread_id ?? cfg?.parent_thread_id;
          const runId = cfg?.run_id;

          state.baseStatus = GraphNodeStatus.Running;

          if (threadId) {
            this.updateThreadStatus(state, threadId, GraphNodeStatus.Running);
          }

          if (runId) {
            this.updateRunStatus(state, runId, GraphNodeStatus.Running);
          }

          if (event.data.error) {
            this.setError(state, event.data.error);
          } else {
            this.clearError(state);
          }

          if (!this.hasActive(state)) {
            state.baseStatus = GraphNodeStatus.Idle;
          }

          this.emitNodeUpdate(state);
        }
      } catch (e) {
        this.logger.error(e as Error, 'Error handling trigger event');
      }
    });

    this.unsubscribers.push(unsub);
  }

  private ensure(nodeId: string) {
    const s = this.nodes.get(nodeId);
    if (!s) {
      throw new NotFoundException(
        'NODE_NOT_FOUND',
        `Node ${nodeId} not registered`,
      );
    }
    return s;
  }

  private updateThreadStatus(
    state: NodeState,
    threadId: string,
    status: GraphNodeStatus,
  ) {
    const prev = state.threadStatuses.get(threadId);
    if (prev === status) return;
    state.threadStatuses.set(threadId, status);
  }

  private updateRunStatus(
    state: NodeState,
    runId: string,
    status: GraphNodeStatus,
  ) {
    const prev = state.runStatuses.get(runId);
    if (prev === status) return;
    state.runStatuses.set(runId, status);
  }

  private hasActive(state: NodeState) {
    return (
      state.threadStatuses.size > 0 ||
      state.runStatuses.size > 0 ||
      state.activeExecs.size > 0
    );
  }

  private buildSnapshotMetadata(
    state: NodeState,
    threadId?: string,
    runId?: string,
  ): GraphExecutionMetadata | undefined {
    const meta: GraphExecutionMetadata = {
      threadId,
      runId,
    };
    return this.hasMeta(meta) ? meta : undefined;
  }

  private buildNodeAdditionalMetadata(
    state: NodeState,
    threadId?: string,
    runId?: string,
  ): Record<string, unknown> | undefined {
    const stored = this.getAdditionalNodeMetadata(state, {
      threadId,
      runId,
    });
    if (stored) {
      return stored;
    }

    const node = state.node;
    if (!node) {
      return undefined;
    }

    const meta: GraphExecutionMetadata = {
      threadId,
      runId,
    };

    if (node.type === NodeKind.SimpleAgent) {
      return (node.instance as SimpleAgent).getGraphNodeMetadata(meta);
    }

    if (node.type === NodeKind.Runtime) {
      return (node.instance as BaseRuntime).getGraphNodeMetadata(meta);
    }

    if (node.type === NodeKind.Trigger) {
      return (node.instance as BaseTrigger).getGraphNodeMetadata(meta);
    }

    return undefined;
  }

  private hasMeta(meta?: GraphExecutionMetadata) {
    return !!(
      meta &&
      (meta.threadId !== undefined ||
        meta.runId !== undefined ||
        meta.parentThreadId !== undefined)
    );
  }

  private setError(state: NodeState, err: unknown) {
    state.error = this.toErrorMessage(err);
  }

  private clearError(state: NodeState) {
    state.error = null;
  }

  private emitNodeUpdate(
    state: NodeState,
    status?: GraphNodeStatus,
    threadId?: string,
    runId?: string,
  ) {
    const metadata = this.buildSnapshotMetadata(state, threadId, runId);
    const additionalNodeMetadata = this.buildNodeAdditionalMetadata(
      state,
      threadId,
      runId,
    );

    void this.notificationsService.emit({
      type: NotificationEvent.GraphNodeUpdate,
      graphId: this.graphId,
      nodeId: state.nodeId,
      threadId,
      runId,
      data: {
        status: status || state.baseStatus,
        error: state.error ?? undefined,
        ...(metadata ? { metadata } : {}),
        ...(additionalNodeMetadata ? { additionalNodeMetadata } : {}),
      },
    });
  }

  private updateAdditionalNodeMetadata(
    state: NodeState,
    meta: GraphExecutionMetadata,
    data?: Record<string, unknown>,
  ) {
    const { threadId, runId } = meta;
    if (threadId) {
      if (data) {
        state.additionalNodeMetadataByThread.set(threadId, data);
      } else {
        state.additionalNodeMetadataByThread.delete(threadId);
      }
      return;
    }

    if (runId) {
      if (data) {
        state.additionalNodeMetadataByRun.set(runId, data);
      } else {
        state.additionalNodeMetadataByRun.delete(runId);
      }
      return;
    }

    state.additionalNodeMetadata = data;
  }

  private getAdditionalNodeMetadata(
    state: NodeState,
    meta: GraphExecutionMetadata,
  ): Record<string, unknown> | undefined {
    if (meta.threadId) {
      const fromThread = state.additionalNodeMetadataByThread.get(
        meta.threadId,
      );
      if (fromThread) {
        return fromThread;
      }
    }

    if (meta.runId) {
      const fromRun = state.additionalNodeMetadataByRun.get(meta.runId);
      if (fromRun) {
        return fromRun;
      }
    }

    return state.additionalNodeMetadata;
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch (e) {
      this.logger.error(e as Error, 'Failed to stringify graph node error');
      return String(error);
    }
  }

  /**
   * Unregister a node from the state manager
   */
  unregisterNode(nodeId: string): void {
    this.nodes.delete(nodeId);
  }
}
