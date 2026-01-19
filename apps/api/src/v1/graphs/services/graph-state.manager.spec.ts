import { Duplex, PassThrough } from 'node:stream';

import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import {
  RuntimeExecParams,
  RuntimeExecResult,
} from '../../runtime/runtime.types';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { ThreadStatus } from '../../threads/threads.types';
import {
  CompiledGraphNode,
  GraphExecutionMetadata,
  GraphNodeInstanceHandle,
  GraphNodeStatus,
  NodeKind,
} from '../graphs.types';
import { GraphStateManager } from './graph-state.manager';

class TestRuntime extends BaseRuntime {
  async start(): Promise<void> {
    this.emit({ type: 'start', data: { params: {} } });
  }

  async stop(): Promise<void> {
    this.emit({ type: 'stop', data: {} });
  }

  async exec(params: RuntimeExecParams): Promise<RuntimeExecResult> {
    const execId = 'test-exec-id';

    // Emit start
    this.emit({
      type: 'execStart',
      data: { execId, params },
    });

    // Simulate async
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Simulate execution
    const result: RuntimeExecResult = {
      fail: false,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      execPath: '/runtime-workspace/test',
    };

    // Emit end
    this.emit({
      type: 'execEnd',
      data: { execId, params, result },
    });

    return result;
  }

  public getRuntimeInfo(): string {
    return 'Runtime type: TestRuntime';
  }

  async execStream(
    _command: string[],
    _options?: {
      workdir?: string;
      env?: Record<string, string>;
    },
  ): Promise<{
    stdin: Duplex;
    stdout: PassThrough;
    stderr: PassThrough;
    close: () => void;
  }> {
    const stdin = new Duplex({
      read() {},
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();

    return {
      stdin,
      stdout,
      stderr,
      close: () => {
        stdin.destroy();
        stdout.destroy();
        stderr.destroy();
      },
    };
  }

  public override getGraphNodeMetadata(
    context?: GraphExecutionMetadata,
  ): Record<string, unknown> | undefined {
    if (!context?.threadId) {
      return undefined;
    }
    return { threadId: context.threadId };
  }
}

const makeHandle = <TInstance>(
  instance: TInstance,
): GraphNodeInstanceHandle<TInstance, any> => ({
  provide: async () => instance,
  configure: async () => {},
  destroy: async () => {},
});

describe('GraphStateManager', () => {
  let notifications: NotificationsService;
  let logger: DefaultLogger;
  let manager: GraphStateManager;

  beforeEach(() => {
    notifications = {
      emit: vi.fn().mockResolvedValue(undefined),
    } as unknown as NotificationsService;
    logger = {
      error: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as DefaultLogger;
    const litellmService = {};
    manager = new GraphStateManager(
      notifications,
      litellmService as any,
      logger,
    );
    manager.setGraphId('graph-1');
  });

  describe('Additional metadata', () => {
    it('should include additional node metadata when available', () => {
      const runtime = new TestRuntime();
      const node: CompiledGraphNode<TestRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: {},
        instance: runtime,
        handle: makeHandle(runtime),
      };

      manager.registerNode('runtime-1');
      manager.attachGraphNode('runtime-1', node);

      const snapshots = manager.getSnapshots('thread-1');
      expect(snapshots[0]?.additionalNodeMetadata).toEqual({
        threadId: 'thread-1',
      });
    });
  });

  describe('Agent events', () => {
    it('should emit ThreadUpdate notification only for active threads on agent stop', async () => {
      const agent: any = {
        subscribe: vi.fn(),
        handle: makeHandle({}),
        getGraphNodeMetadata: vi.fn(),
      };
      let agentHandler: any;
      agent.subscribe.mockImplementation((handler: any) => {
        agentHandler = handler;
        return vi.fn();
      });

      const node: CompiledGraphNode = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: agent,
        handle: makeHandle(agent),
      };

      manager.registerNode('agent-1');
      manager.attachGraphNode('agent-1', node);

      // Simulate thread execution
      await agentHandler({
        type: 'invoke',
        data: {
          threadId: 'thread-1',
          config: { configurable: { graph_id: 'graph-1', node_id: 'agent-1' } },
        },
      });

      vi.mocked(notifications.emit).mockClear();

      // Simulate agent stop
      await agentHandler({
        type: 'stop',
        data: {
          config: { configurable: { graph_id: 'graph-1', node_id: 'agent-1' } },
        },
      });

      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEvent.ThreadUpdate,
          threadId: 'thread-1',
          data: { status: ThreadStatus.Stopped },
        }),
      );
    });

    it('should not mark parent thread done when child agent completes', async () => {
      const agent: any = {
        subscribe: vi.fn(),
        getGraphNodeMetadata: vi.fn(),
      };
      let agentHandler: any;
      agent.subscribe.mockImplementation((handler: any) => {
        agentHandler = handler;
        return vi.fn();
      });

      const node: CompiledGraphNode = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: agent,
        handle: makeHandle(agent),
      };

      manager.registerNode('agent-1');
      manager.attachGraphNode('agent-1', node);

      // Simulate child agent execution
      await agentHandler({
        type: 'run',
        data: {
          threadId: 'child-thread',
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-thread',
            },
          },
        },
      });

      const threadUpdate = vi
        .mocked(notifications.emit)
        .mock.calls.find(
          (call: any) => call[0].type === NotificationEvent.ThreadUpdate,
        );

      expect(threadUpdate).toBeUndefined();
    });

    it('should track node status as Running when at least one thread is active', async () => {
      const agent: any = {
        subscribe: vi.fn(),
        getGraphNodeMetadata: vi.fn(),
      };
      let agentHandler: any;
      agent.subscribe.mockImplementation((handler: any) => {
        agentHandler = handler;
        return vi.fn();
      });

      const node: CompiledGraphNode = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: agent,
        handle: makeHandle(agent),
      };

      manager.registerNode('agent-1');
      manager.attachGraphNode('agent-1', node);

      // Start thread 1
      await agentHandler({
        type: 'invoke',
        data: {
          threadId: 'thread-1',
          config: { configurable: { graph_id: 'graph-1', node_id: 'agent-1' } },
        },
      });
      expect(manager.getNodeStatus('agent-1')).toBe(GraphNodeStatus.Running);

      // Start thread 2
      await agentHandler({
        type: 'invoke',
        data: {
          threadId: 'thread-2',
          config: { configurable: { graph_id: 'graph-1', node_id: 'agent-1' } },
        },
      });
      expect(manager.getNodeStatus('agent-1')).toBe(GraphNodeStatus.Running);

      // End thread 1
      await agentHandler({
        type: 'run',
        data: {
          threadId: 'thread-1',
          config: { configurable: { graph_id: 'graph-1', node_id: 'agent-1' } },
        },
      });
      expect(manager.getNodeStatus('agent-1')).toBe(GraphNodeStatus.Running);

      // End thread 2
      await agentHandler({
        type: 'run',
        data: {
          threadId: 'thread-2',
          config: { configurable: { graph_id: 'graph-1', node_id: 'agent-1' } },
        },
      });
      expect(manager.getNodeStatus('agent-1')).toBe(GraphNodeStatus.Idle);
    });

    it('should emit all agent notification types correctly', async () => {
      const agent: any = {
        subscribe: vi.fn(),
        getGraphNodeMetadata: vi.fn(),
      };
      let agentHandler: any;
      agent.subscribe.mockImplementation((handler: any) => {
        agentHandler = handler;
        return vi.fn();
      });

      const node: CompiledGraphNode = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: agent,
        handle: makeHandle(agent),
      };

      manager.registerNode('agent-1');
      manager.attachGraphNode('agent-1', node);

      const commonConfig = {
        configurable: {
          graph_id: 'graph-1',
          node_id: 'agent-1',
          parent_thread_id: 'p1',
          source: 'test',
        },
      };

      // Invoke
      await agentHandler({
        type: 'invoke',
        data: { threadId: 't1', messages: [], config: commonConfig },
      });
      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationEvent.AgentInvoke }),
      );

      // Message
      await agentHandler({
        type: 'message',
        data: { threadId: 't1', messages: [], config: commonConfig },
      });
      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationEvent.AgentMessage }),
      );

      // State update
      await agentHandler({
        type: 'stateUpdate',
        data: { threadId: 't1', stateChange: {}, config: commonConfig },
      });
      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: NotificationEvent.AgentStateUpdate }),
      );
    });

    it('should use threadId as parentThreadId for root agent events (no parent_thread_id)', async () => {
      const agent: any = {
        subscribe: vi.fn(),
        getGraphNodeMetadata: vi.fn(),
      };
      let agentHandler: any;
      agent.subscribe.mockImplementation((handler: any) => {
        agentHandler = handler;
        return vi.fn();
      });

      const node: CompiledGraphNode = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: agent,
        handle: makeHandle(agent),
      };

      manager.registerNode('agent-1');
      manager.attachGraphNode('agent-1', node);

      vi.mocked(notifications.emit).mockClear();

      const threadId = 'root-thread';
      const cfg = {
        configurable: {
          graph_id: 'graph-1',
          node_id: 'agent-1',
          // parent_thread_id intentionally missing
        },
      };

      await agentHandler({
        type: 'invoke',
        data: { threadId, messages: [], config: cfg },
      });

      await agentHandler({
        type: 'message',
        data: { threadId, messages: [], config: cfg },
      });

      await agentHandler({
        type: 'stateUpdate',
        data: { threadId, stateChange: { totalPrice: 0.01 }, config: cfg },
      });

      const agentInvoke = vi
        .mocked(notifications.emit)
        .mock.calls.find(
          (c: any) => c[0]?.type === NotificationEvent.AgentInvoke,
        )?.[0];
      const agentMessage = vi
        .mocked(notifications.emit)
        .mock.calls.find(
          (c: any) => c[0]?.type === NotificationEvent.AgentMessage,
        )?.[0];
      const agentStateUpdate = vi
        .mocked(notifications.emit)
        .mock.calls.find(
          (c: any) => c[0]?.type === NotificationEvent.AgentStateUpdate,
        )?.[0];

      expect(agentInvoke).toMatchObject({
        threadId,
        parentThreadId: threadId,
      });
      expect(agentMessage).toMatchObject({
        threadId,
        parentThreadId: threadId,
      });
      expect(agentStateUpdate).toMatchObject({
        threadId,
        parentThreadId: threadId,
      });
    });

    it('should not emit duplicate GraphNodeUpdate notifications', async () => {
      const agent: any = {
        subscribe: vi.fn(),
        getGraphNodeMetadata: vi.fn(),
      };
      let agentHandler: any;
      agent.subscribe.mockImplementation((handler: any) => {
        agentHandler = handler;
        return vi.fn();
      });

      const node: CompiledGraphNode = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: agent,
        handle: makeHandle(agent),
      };

      manager.registerNode('agent-1');
      manager.attachGraphNode('agent-1', node);

      vi.mocked(notifications.emit).mockClear();

      // Trigger transition to same status
      await agentHandler({
        type: 'invoke',
        data: {
          threadId: 't1',
          config: { configurable: { graph_id: 'graph-1', node_id: 'agent-1' } },
        },
      });
      await agentHandler({
        type: 'invoke',
        data: {
          threadId: 't1',
          config: { configurable: { graph_id: 'graph-1', node_id: 'agent-1' } },
        },
      });

      const updates = vi
        .mocked(notifications.emit)
        .mock.calls.filter(
          (call: any) => call[0].type === NotificationEvent.GraphNodeUpdate,
        );

      // status: Running was already emitted once
      expect(updates.length).toBe(1);
    });

    it('should update additional metadata when agent emits nodeAdditionalMetadataUpdate', async () => {
      const agent: any = {
        subscribe: vi.fn(),
        getGraphNodeMetadata: vi.fn(),
      };
      let agentHandler: any;
      agent.subscribe.mockImplementation((handler: any) => {
        agentHandler = handler;
        return vi.fn();
      });

      const node: CompiledGraphNode = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: agent,
        handle: makeHandle(agent),
      };

      manager.registerNode('agent-1');
      manager.attachGraphNode('agent-1', node);

      const metadata = { threadId: 'thread-1' };
      const additionalMetadata = { key: 'value' };

      await agentHandler({
        type: 'nodeAdditionalMetadataUpdate',
        data: { metadata, additionalMetadata },
      });

      const snapshots = manager.getSnapshots('thread-1');
      expect(snapshots[0]?.additionalNodeMetadata).toEqual(additionalMetadata);
    });
  });

  describe('Snapshots and Filters', () => {
    it('should return snapshots with filters', () => {
      const runtime = new TestRuntime();
      const node: CompiledGraphNode<TestRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: { c: 1 },
        instance: runtime,
        handle: makeHandle(runtime),
      };

      manager.registerNode('runtime-1');
      manager.attachGraphNode('runtime-1', node);

      const snapshots = manager.getSnapshots();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]).toMatchObject({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        config: { c: 1 },
      });
    });
  });

  describe('Cleanup', () => {
    it('should handle destroy cleanup', async () => {
      const runtime = new TestRuntime();

      const node: CompiledGraphNode<TestRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: {},
        instance: runtime,
        handle: makeHandle(runtime),
      };

      manager.registerNode('runtime-1');
      manager.attachGraphNode('runtime-1', node);

      manager.destroy();

      expect(manager.getSnapshots()).toHaveLength(0);
    });
  });
});
