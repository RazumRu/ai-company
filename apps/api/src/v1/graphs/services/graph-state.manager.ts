import { Injectable, Scope } from '@nestjs/common';
import { DefaultLogger, NotFoundException } from '@packages/common';
import { isEqual } from 'lodash';

import { BaseTrigger } from '../../agent-triggers/services/base-trigger';
import {
  AgentInvokeEvent,
  AgentMessageEvent,
  AgentNodeAdditionalMetadataUpdateEvent,
  AgentRunEvent,
  AgentStateUpdateEvent,
  AgentStopEvent,
} from '../../agents/services/agents/base-agent';
import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import type { IGraphNodeUpdateData } from '../../notifications/notifications.types';
import { NotificationEvent } from '../../notifications/notifications.types';
import { serializeBaseMessages } from '../../notifications/notifications.utils';
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

interface ExecutionContext {
  threadId?: string;
  runId?: string;
}

interface NodeState {
  nodeId: string;
  node?: CompiledGraphNode;
  baseStatus: GraphNodeStatus;
  error: string | null;

  // Execution tracking - unified instead of separate thread/run/exec maps
  activeExecutions: Map<string, ExecutionContext>;

  // Metadata storage - unified lookup
  metadata: {
    base?: Record<string, unknown>;
    byThread: Map<string, Record<string, unknown>>;
    byRun: Map<string, Record<string, unknown>>;
  };

  // Deduplication tracking - unified
  lastEmitted: {
    base?: IGraphNodeUpdateData;
    byThread: Map<string, IGraphNodeUpdateData>;
    byRun: Map<string, IGraphNodeUpdateData>;
  };
}

@Injectable({ scope: Scope.TRANSIENT })
export class GraphStateManager {
  private readonly nodes = new Map<string, NodeState>();
  private readonly nodeUnsubscribers = new Map<string, (() => void)[]>();
  private graphId = '';

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
      error: null,
      activeExecutions: new Map(),
      metadata: {
        base: undefined,
        byThread: new Map(),
        byRun: new Map(),
      },
      lastEmitted: {
        base: undefined,
        byThread: new Map(),
        byRun: new Map(),
      },
    });

    this.nodeUnsubscribers.set(nodeId, []);
  }

  attachGraphNode(nodeId: string, node: CompiledGraphNode) {
    const state = this.ensure(nodeId);

    // Detach previous subscriptions to avoid duplicate listeners on live reconfigure
    this.unsubscribeNode(nodeId);
    this.nodeUnsubscribers.set(nodeId, []);

    state.node = node;
    state.baseStatus = GraphNodeStatus.Idle;
    state.error = null;

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
    const state = this.ensure(nodeId);
    const activeExec = Array.from(state.activeExecutions.values()).find(
      (exec) => exec.threadId === threadId,
    );
    return activeExec ? GraphNodeStatus.Running : undefined;
  }

  getNodeRunStatus(nodeId: string, runId: string) {
    const state = this.ensure(nodeId);
    const activeExec = Array.from(state.activeExecutions.values()).find(
      (exec) => exec.runId === runId,
    );
    return activeExec ? GraphNodeStatus.Running : undefined;
  }

  getActiveExecList(nodeId: string) {
    const state = this.ensure(nodeId);
    return Array.from(state.activeExecutions.entries()).map(
      ([execId, context]) => ({
        execId,
        threadId: context.threadId,
        runId: context.runId,
        startedAt: Date.now(), // Note: startedAt removed from context - can be tracked separately if needed
      }),
    );
  }

  getSnapshots(threadId?: string, runId?: string): GraphNodeStateSnapshot[] {
    return Array.from(this.nodes.values())
      .filter((state) => state.node)
      .map((state) => {
        const node = state.node!;
        const status = this.computeDisplayStatus(state, threadId, runId);
        const metadata = this.buildExecutionMetadata(threadId, runId);
        const additionalNodeMetadata = this.getMetadata(state, threadId, runId);

        return {
          id: node.id,
          name: node.id,
          template: node.template,
          type: node.type,
          status,
          config: node.config,
          error: state.error,
          ...(metadata ? { metadata } : {}),
          ...(additionalNodeMetadata ? { additionalNodeMetadata } : {}),
        };
      });
  }

  private computeDisplayStatus(
    state: NodeState,
    threadId?: string,
    runId?: string,
  ): GraphNodeStatus {
    if (threadId) {
      return (
        this.getNodeThreadStatus(state.nodeId, threadId) ?? state.baseStatus
      );
    }
    if (runId) {
      return this.getNodeRunStatus(state.nodeId, runId) ?? state.baseStatus;
    }
    return state.baseStatus;
  }

  destroy() {
    for (const nodeId of this.nodes.keys()) {
      this.unsubscribeNode(nodeId);
      this.clearNodeState(this.nodes.get(nodeId)!);
    }

    this.nodes.clear();
    this.nodeUnsubscribers.clear();
  }

  private unsubscribeNode(nodeId: string) {
    const unsubs = this.nodeUnsubscribers.get(nodeId) || [];
    for (const unsub of unsubs) {
      this.callUnsubscriber(unsub);
    }
  }

  private callUnsubscriber(unsub: () => void) {
    try {
      unsub();
    } catch (error) {
      this.logger.error(error as Error, 'Error during unsubscribe');
    }
  }

  private clearNodeState(state: NodeState) {
    state.activeExecutions.clear();
    state.metadata.byThread.clear();
    state.metadata.byRun.clear();
    state.metadata.base = undefined;
    state.lastEmitted.byThread.clear();
    state.lastEmitted.byRun.clear();
    state.lastEmitted.base = undefined;
    state.baseStatus = GraphNodeStatus.Stopped;
    state.error = null;
  }

  private attachRuntimeListeners(
    state: NodeState,
    node: CompiledGraphNode<BaseRuntime>,
  ) {
    const runtime = node.instance;
    const unsub = runtime.subscribe(async (event) => {
      if (event.type === 'start') {
        state.baseStatus = GraphNodeStatus.Idle;
        state.error = null;
        this.emitNodeUpdate(state);
        return;
      }

      if (event.type === 'stop') {
        state.activeExecutions.clear();
        state.baseStatus = GraphNodeStatus.Stopped;
        if (event.data.error) {
          state.error = this.toErrorMessage(event.data.error);
        }
        this.emitNodeUpdate(state);
        return;
      }

      if (event.type === 'execStart') {
        const { execId, params } = event.data;
        const meta = params.metadata;

        state.activeExecutions.set(execId, {
          threadId: meta?.threadId,
          runId: meta?.runId,
        });
        state.baseStatus = GraphNodeStatus.Running;

        this.emitNodeUpdate(state);
        return;
      }

      if (event.type === 'execEnd') {
        const { execId, error } = event.data;
        const context = state.activeExecutions.get(execId);

        state.error = error ? this.toErrorMessage(error) : null;
        state.activeExecutions.delete(execId);

        if (state.activeExecutions.size === 0) {
          state.baseStatus = GraphNodeStatus.Idle;
        }

        if (context) {
          this.emitNodeUpdate(state, context.threadId, context.runId);
        } else {
          this.emitNodeUpdate(state);
        }
      }
    });

    this.addUnsubscriber(state.nodeId, unsub);
  }

  private attachAgentListeners(
    state: NodeState,
    node: CompiledGraphNode<SimpleAgent>,
  ) {
    const agent = node.instance;

    const unsub = agent.subscribe(async (event) => {
      try {
        if (event.type === 'invoke') {
          await this.handleAgentInvoke(state, event.data);
          return;
        }

        if (event.type === 'message') {
          await this.handleAgentMessage(event.data);
          return;
        }

        if (event.type === 'stateUpdate') {
          await this.handleAgentStateUpdate(event.data);
          return;
        }

        if (event.type === 'run') {
          await this.handleAgentRun(state, event.data);
          return;
        }

        if (event.type === 'stop') {
          await this.handleAgentStop(state, event.data);
          return;
        }

        if (event.type === 'nodeAdditionalMetadataUpdate') {
          const changed = this.handleMetadataUpdate(state, event.data);
          if (!changed) {
            return;
          }
          this.emitNodeUpdate(
            state,
            event.data.metadata.threadId,
            event.data.metadata.runId,
          );
        }
      } catch (error) {
        this.logger.error(error as Error, 'Error handling agent event');
      }
    });

    this.addUnsubscriber(state.nodeId, unsub);
  }

  private async handleAgentInvoke(state: NodeState, data: AgentInvokeEvent) {
    const cfg = data.config?.configurable;
    const threadId = data.threadId;
    const runId = cfg?.run_id;
    const execId = `${threadId || 'no-thread'}-${runId || 'no-run'}-${Date.now()}`;

    state.activeExecutions.set(execId, { threadId, runId });
    state.baseStatus = GraphNodeStatus.Running;

    this.emitNodeUpdate(state, threadId, runId);

    await this.notificationsService.emit({
      type: NotificationEvent.AgentInvoke,
      graphId: cfg?.graph_id || this.graphId,
      nodeId: cfg?.node_id || state.nodeId,
      threadId,
      // For root runs parent_thread_id is typically not set. We must still emit a stable key
      // so downstream token/cost aggregation does not end up under a bogus "unknown" thread.
      parentThreadId: cfg?.parent_thread_id ?? threadId,
      ...(runId ? { runId } : {}),
      source: cfg?.source,
      data: {
        messages: serializeBaseMessages(data.messages),
      },
    });
  }

  private async handleAgentMessage(data: AgentMessageEvent) {
    const cfg = data.config?.configurable;
    const threadId = data.threadId;
    await this.notificationsService.emit({
      type: NotificationEvent.AgentMessage,
      graphId: cfg?.graph_id || this.graphId,
      nodeId: cfg?.node_id || 'unknown',
      threadId,
      parentThreadId: cfg?.parent_thread_id ?? threadId,
      data: {
        messages: serializeBaseMessages(data.messages),
      },
    });
  }

  private async handleAgentStateUpdate(data: AgentStateUpdateEvent) {
    const cfg = data.config?.configurable;
    const threadId = data.threadId;
    await this.notificationsService.emit({
      type: NotificationEvent.AgentStateUpdate,
      graphId: cfg?.graph_id || this.graphId,
      nodeId: cfg?.node_id || 'unknown',
      threadId,
      parentThreadId: cfg?.parent_thread_id ?? threadId,
      data: data.stateChange,
    });
  }

  private async handleAgentRun(state: NodeState, data: AgentRunEvent) {
    const cfg = data.config?.configurable;
    const threadId = data.threadId;
    const runId = cfg?.run_id;
    const parentThreadId = cfg?.parent_thread_id;

    // Remove matching execution(s) by threadId/runId
    for (const [execId, context] of state.activeExecutions.entries()) {
      if (context.threadId === threadId && context.runId === runId) {
        state.activeExecutions.delete(execId);
        break;
      }
    }

    // Only emit thread status for root thread (not nested agents)
    const isRootThread = !parentThreadId || parentThreadId === threadId;

    if (isRootThread && threadId) {
      const finalStatus = data.error
        ? ThreadStatus.Stopped
        : data.result?.needsMoreInfo
          ? ThreadStatus.NeedMoreInfo
          : ThreadStatus.Done;

      state.error = data.error ? this.toErrorMessage(data.error) : null;

      await this.notificationsService.emit({
        type: NotificationEvent.ThreadUpdate,
        graphId: this.graphId,
        nodeId: state.nodeId,
        threadId,
        parentThreadId: parentThreadId || 'unknown',
        data: { status: finalStatus },
      });
    }

    if (state.activeExecutions.size === 0) {
      state.baseStatus = GraphNodeStatus.Idle;
    }

    this.emitNodeUpdate(state, threadId, runId);
  }

  private async handleAgentStop(state: NodeState, data: AgentStopEvent) {
    const cfg = data.config?.configurable;
    const parentThreadId = cfg?.parent_thread_id || 'unknown';

    // Get all active threads before clearing
    const activeThreads = Array.from(
      new Set(
        Array.from(state.activeExecutions.values())
          .map((exec) => exec.threadId)
          .filter((id): id is string => id !== undefined),
      ),
    );

    // Emit stopped status for all active threads
    for (const threadId of activeThreads) {
      await this.notificationsService.emit({
        type: NotificationEvent.ThreadUpdate,
        graphId: this.graphId,
        nodeId: state.nodeId,
        threadId,
        parentThreadId,
        data: { status: ThreadStatus.Stopped },
      });
    }

    state.activeExecutions.clear();
    state.baseStatus = GraphNodeStatus.Stopped;

    if (data.error) {
      state.error = this.toErrorMessage(data.error);
    }

    this.emitNodeUpdate(state);
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
          state.error = null;
          this.emitNodeUpdate(state);
          return;
        }

        if (event.type === 'stop') {
          state.activeExecutions.clear();
          state.baseStatus = GraphNodeStatus.Stopped;
          if (event.data.error) {
            state.error = this.toErrorMessage(event.data.error);
          }
          this.emitNodeUpdate(state);
          return;
        }

        if (event.type === 'invoke') {
          const cfg = event.data.config?.configurable;
          const threadId = cfg?.thread_id ?? cfg?.parent_thread_id;
          const runId = cfg?.run_id;
          const execId = `${threadId || 'no-thread'}-${runId || 'no-run'}-${Date.now()}`;

          state.activeExecutions.set(execId, { threadId, runId });
          state.baseStatus = GraphNodeStatus.Running;

          if (event.data.error) {
            state.error = this.toErrorMessage(event.data.error);
          } else {
            state.error = null;
          }

          // Immediate completion for triggers
          state.activeExecutions.delete(execId);
          if (state.activeExecutions.size === 0) {
            state.baseStatus = GraphNodeStatus.Idle;
          }

          this.emitNodeUpdate(state, threadId, runId);
        }
      } catch (error) {
        this.logger.error(error as Error, 'Error handling trigger event');
      }
    });

    this.addUnsubscriber(state.nodeId, unsub);
  }

  private ensure(nodeId: string): NodeState {
    const state = this.nodes.get(nodeId);
    if (!state) {
      throw new NotFoundException(
        'NODE_NOT_FOUND',
        `Node ${nodeId} not registered`,
      );
    }
    return state;
  }

  private addUnsubscriber(nodeId: string, unsub: () => void) {
    this.nodeUnsubscribers.get(nodeId)?.push(unsub);
  }

  private buildExecutionMetadata(
    threadId?: string,
    runId?: string,
  ): GraphExecutionMetadata | undefined {
    if (!threadId && !runId) {
      return undefined;
    }
    return { threadId, runId };
  }

  private getMetadata(
    state: NodeState,
    threadId?: string,
    runId?: string,
  ): Record<string, unknown> | undefined {
    // Check stored metadata first
    if (threadId) {
      const stored = state.metadata.byThread.get(threadId);
      if (stored) return stored;
    }

    if (runId) {
      const stored = state.metadata.byRun.get(runId);
      if (stored) return stored;
    }

    if (state.metadata.base) {
      return state.metadata.base;
    }

    // Fall back to querying node instance
    const node = state.node;
    if (!node) return undefined;

    const meta: GraphExecutionMetadata = { threadId, runId };

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

  private emitNodeUpdate(state: NodeState, threadId?: string, runId?: string) {
    const currentStatus = this.computeDisplayStatus(state, threadId, runId);

    const metadata = this.buildExecutionMetadata(threadId, runId);
    const additionalNodeMetadata = this.getMetadata(state, threadId, runId);

    const data: IGraphNodeUpdateData = {
      status: currentStatus,
      error: state.error,
      ...(metadata ? { metadata } : {}),
      ...(additionalNodeMetadata ? { additionalNodeMetadata } : {}),
    };

    if (threadId) {
      const prev = state.lastEmitted.byThread.get(threadId);
      if (prev && isEqual(prev, data)) {
        return;
      }
      state.lastEmitted.byThread.set(threadId, data);
    } else if (runId) {
      const prev = state.lastEmitted.byRun.get(runId);
      if (prev && isEqual(prev, data)) {
        return;
      }
      state.lastEmitted.byRun.set(runId, data);
    } else {
      const prev = state.lastEmitted.base;
      if (prev && isEqual(prev, data)) {
        return;
      }
      state.lastEmitted.base = data;
    }

    void this.notificationsService.emit({
      type: NotificationEvent.GraphNodeUpdate,
      graphId: this.graphId,
      nodeId: state.nodeId,
      threadId,
      runId,
      data,
    });
  }

  private handleMetadataUpdate(
    state: NodeState,
    data: AgentNodeAdditionalMetadataUpdateEvent,
  ): boolean {
    const { threadId, runId } = data.metadata;

    if (threadId) {
      const prev = state.metadata.byThread.get(threadId);
      const next = data.additionalMetadata;
      const changed = !isEqual(prev, next);
      if (!changed) {
        return false;
      }

      if (next) {
        state.metadata.byThread.set(threadId, next);
      } else {
        state.metadata.byThread.delete(threadId);
      }
      return true;
    }

    if (runId) {
      const prev = state.metadata.byRun.get(runId);
      const next = data.additionalMetadata;
      const changed = !isEqual(prev, next);
      if (!changed) {
        return false;
      }

      if (next) {
        state.metadata.byRun.set(runId, next);
      } else {
        state.metadata.byRun.delete(runId);
      }
      return true;
    }

    const prev = state.metadata.base;
    const next = data.additionalMetadata;
    const changed = !isEqual(prev, next);
    if (!changed) {
      return false;
    }

    state.metadata.base = next;
    return true;
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch (stringifyError) {
      this.logger.error(
        stringifyError as Error,
        'Failed to stringify graph node error',
      );
      return String(error);
    }
  }

  unregisterNode(nodeId: string): void {
    this.unsubscribeNode(nodeId);
    this.nodeUnsubscribers.delete(nodeId);
    this.nodes.delete(nodeId);
  }
}
