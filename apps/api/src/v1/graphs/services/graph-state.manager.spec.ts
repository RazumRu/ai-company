import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import {
  RuntimeExecParams,
  RuntimeExecResult,
} from '../../runtime/runtime.types';
import { BaseRuntime } from '../../runtime/services/base-runtime';
import { CompiledGraphNode, GraphNodeStatus, NodeKind } from '../graphs.types';
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

    // Simulate execution
    const result: RuntimeExecResult = {
      fail: false,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    };

    // Emit end
    this.emit({
      type: 'execEnd',
      data: { execId, params, result },
    });

    return result;
  }
}

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
    manager = new GraphStateManager(notifications, logger);
    manager.setGraphId('graph-1');
  });

  describe('Runtime events', () => {
    it('should track runtime exec start and end events', async () => {
      const runtime = new TestRuntime();
      const node: CompiledGraphNode<TestRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: {},
        instance: runtime,
      };

      manager.registerNode('runtime-1');
      manager.attachGraphNode('runtime-1', node);

      // Execute command
      await runtime.exec({
        cmd: 'echo ok',
        metadata: {
          threadId: 'thread-1',
          runId: 'run-1',
        },
      });

      // Check final status
      const snapshots = manager.getSnapshots();
      expect(snapshots[0]?.status).toBe(GraphNodeStatus.Idle);
      expect(snapshots[0]?.error).toBeNull();

      // Check notifications were emitted
      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEvent.GraphNodeUpdate,
          graphId: 'graph-1',
          nodeId: 'runtime-1',
          data: expect.objectContaining({
            status: GraphNodeStatus.Running,
          }),
        }),
      );
    });

    it('should track per-thread status', async () => {
      const runtime = new TestRuntime();
      const node: CompiledGraphNode<TestRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: {},
        instance: runtime,
      };

      manager.registerNode('runtime-1');
      manager.attachGraphNode('runtime-1', node);

      await runtime.exec({
        cmd: 'echo ok',
        metadata: {
          threadId: 'thread-1',
        },
      });

      const threadStatus = manager.getNodeThreadStatus('runtime-1', 'thread-1');
      expect(threadStatus).toBeUndefined(); // Should be cleared after exec ends
    });

    it('should track per-run status', async () => {
      const runtime = new TestRuntime();
      const node: CompiledGraphNode<TestRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: {},
        instance: runtime,
      };

      manager.registerNode('runtime-1');
      manager.attachGraphNode('runtime-1', node);

      await runtime.exec({
        cmd: 'echo ok',
        metadata: {
          runId: 'run-1',
        },
      });

      const runStatus = manager.getNodeRunStatus('runtime-1', 'run-1');
      expect(runStatus).toBeUndefined(); // Should be cleared after exec ends
    });

    it('should handle runtime start event', async () => {
      const runtime = new TestRuntime();
      const node: CompiledGraphNode<TestRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: {},
        instance: runtime,
      };

      manager.registerNode('runtime-1');
      manager.attachGraphNode('runtime-1', node);

      await runtime.start();

      const status = manager.getNodeStatus('runtime-1');
      expect(status).toBe(GraphNodeStatus.Idle);
    });

    it('should handle runtime stop event', async () => {
      const runtime = new TestRuntime();
      const node: CompiledGraphNode<TestRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: {},
        instance: runtime,
      };

      manager.registerNode('runtime-1');
      manager.attachGraphNode('runtime-1', node);

      await runtime.stop();

      const status = manager.getNodeStatus('runtime-1');
      expect(status).toBe(GraphNodeStatus.Stopped);
    });
  });

  describe('Agent events', () => {
    it('should emit ThreadUpdate notification only for active threads on agent stop', async () => {
      let subscribeFn: ((event: any) => void) | undefined;

      const agent = {
        subscribe: vi.fn((callback) => {
          subscribeFn = callback;
          return vi.fn(); // unsubscribe
        }),
      };

      const node = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: agent,
      } as unknown as CompiledGraphNode;

      manager.registerNode('agent-1');
      manager.attachGraphNode('agent-1', node);

      // First simulate invoke event
      subscribeFn?.({
        type: 'invoke',
        data: {
          threadId: 'thread-1',
          messages: [],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
              run_id: 'run-1',
            },
          },
        },
      });

      // Invoke second thread
      subscribeFn?.({
        type: 'invoke',
        data: {
          threadId: 'thread-2',
          messages: [],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
              run_id: 'run-2',
            },
          },
        },
      });

      // First thread completes
      await subscribeFn?.({
        type: 'run',
        data: {
          threadId: 'thread-1',
          messages: [],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
              run_id: 'run-1',
            },
          },
          result: { messages: [], threadId: 'thread-1' },
        },
      });

      // Stop is called while thread-2 is still active
      await subscribeFn?.({
        type: 'stop',
        data: {},
      });

      // Should emit ThreadUpdate only for thread-2 (still active in threadStatuses)
      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEvent.ThreadUpdate,
          graphId: 'graph-1',
          nodeId: 'agent-1',
          threadId: 'thread-2',
          data: { status: 'stopped' },
        }),
      );

      // Thread-1 should have received exactly ONE ThreadUpdate when it completed (Done status)
      // But should NOT receive another ThreadUpdate on stop since it already finished
      const thread1Calls = (notifications.emit as any).mock.calls.filter(
        (call: any) =>
          call[0]?.type === NotificationEvent.ThreadUpdate &&
          call[0]?.threadId === 'thread-1',
      );
      // Should have exactly 1 ThreadUpdate with Done status
      expect(thread1Calls.length).toBe(1);
      expect(thread1Calls[0][0].data.status).toBe('done');
    });

    it('should track node status as Running when at least one thread is active', async () => {
      let subscribeFn: ((event: any) => void) | undefined;

      const agent = {
        subscribe: vi.fn((callback) => {
          subscribeFn = callback;
          return vi.fn(); // unsubscribe
        }),
      };

      const node = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: agent,
      } as unknown as CompiledGraphNode;

      manager.registerNode('agent-1');
      manager.attachGraphNode('agent-1', node);

      // Simulate first invoke
      subscribeFn?.({
        type: 'invoke',
        data: {
          threadId: 'thread-1',
          messages: [],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
              run_id: 'run-1',
            },
          },
        },
      });

      // Simulate second invoke (concurrent thread)
      subscribeFn?.({
        type: 'invoke',
        data: {
          threadId: 'thread-2',
          messages: [],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
              run_id: 'run-2',
            },
          },
        },
      });

      // First run completes - await this since it's async
      await subscribeFn?.({
        type: 'run',
        data: {
          threadId: 'thread-1',
          messages: [],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
              run_id: 'run-1',
            },
          },
          result: { messages: [], threadId: 'thread-1' },
        },
      });

      // Node should still be Running because thread-2 is still active
      const status = manager.getNodeStatus('agent-1');
      expect(status).toBe(GraphNodeStatus.Running);

      // Check thread status - thread-1 should be removed after completion, thread-2 should still be there
      const thread1Status = manager.getNodeThreadStatus('agent-1', 'thread-1');
      expect(thread1Status).toBeUndefined(); // Cleaned up after run completion

      const thread2Status = manager.getNodeThreadStatus('agent-1', 'thread-2');
      expect(thread2Status).toBe(GraphNodeStatus.Running);
    });

    it('should emit all agent notification types correctly', async () => {
      let subscribeFn: ((event: any) => void) | undefined;

      const agent = {
        subscribe: vi.fn((callback) => {
          subscribeFn = callback;
          return vi.fn();
        }),
      };

      const node = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: agent,
      } as unknown as CompiledGraphNode;

      manager.registerNode('agent-1');
      manager.attachGraphNode('agent-1', node);

      vi.clearAllMocks();

      // Test AgentInvoke notification
      await subscribeFn?.({
        type: 'invoke',
        data: {
          threadId: 'thread-1',
          messages: [{ content: 'test' }],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
              source: 'test-source',
            },
          },
        },
      });

      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEvent.AgentInvoke,
          graphId: 'graph-1',
          nodeId: 'agent-1',
          threadId: 'thread-1',
          parentThreadId: 'parent-1',
          source: 'test-source',
        }),
      );

      // Test GraphNodeUpdate notification (emitted on invoke)
      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEvent.GraphNodeUpdate,
          graphId: 'graph-1',
          nodeId: 'agent-1',
          data: {
            status: GraphNodeStatus.Running,
            error: undefined,
          },
        }),
      );

      vi.clearAllMocks();

      // Test AgentMessage notification
      await subscribeFn?.({
        type: 'message',
        data: {
          threadId: 'thread-1',
          messages: [{ content: 'response' }],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
            },
          },
        },
      });

      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEvent.AgentMessage,
          graphId: 'graph-1',
          nodeId: 'agent-1',
          threadId: 'thread-1',
          parentThreadId: 'parent-1',
        }),
      );

      vi.clearAllMocks();

      // Test AgentStateUpdate notification
      await subscribeFn?.({
        type: 'stateUpdate',
        data: {
          threadId: 'thread-1',
          stateChange: { done: true, summary: 'Complete' },
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
            },
          },
        },
      });

      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEvent.AgentStateUpdate,
          graphId: 'graph-1',
          nodeId: 'agent-1',
          threadId: 'thread-1',
          parentThreadId: 'parent-1',
          data: { done: true, summary: 'Complete' },
        }),
      );

      vi.clearAllMocks();

      // Test run completion - should emit GraphNodeUpdate
      await subscribeFn?.({
        type: 'run',
        data: {
          threadId: 'thread-1',
          messages: [],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
              run_id: 'run-1',
            },
          },
          result: { messages: [], threadId: 'thread-1' },
        },
      });

      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEvent.GraphNodeUpdate,
          graphId: 'graph-1',
          nodeId: 'agent-1',
          data: {
            status: GraphNodeStatus.Idle,
            error: undefined,
          },
        }),
      );

      // Should also emit ThreadUpdate with final status
      expect(notifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEvent.ThreadUpdate,
          graphId: 'graph-1',
          nodeId: 'agent-1',
          threadId: 'thread-1',
          data: {
            status: 'done',
          },
        }),
      );

      // Verify we have both notifications
      const allCalls = (notifications.emit as any).mock.calls;
      expect(allCalls.length).toBe(2); // GraphNodeUpdate and ThreadUpdate after run
    });

    it('should not emit duplicate GraphNodeUpdate notifications', async () => {
      let subscribeFn: ((event: any) => void) | undefined;

      const agent = {
        subscribe: vi.fn((callback) => {
          subscribeFn = callback;
          return vi.fn();
        }),
      };

      const node = {
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: agent,
      } as unknown as CompiledGraphNode;

      manager.registerNode('agent-1');
      manager.attachGraphNode('agent-1', node);

      vi.clearAllMocks();

      // Invoke thread
      await subscribeFn?.({
        type: 'invoke',
        data: {
          threadId: 'thread-1',
          messages: [],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
            },
          },
        },
      });

      const invokeUpdateCalls = (notifications.emit as any).mock.calls.filter(
        (call: any) => call[0]?.type === NotificationEvent.GraphNodeUpdate,
      );

      // Should emit GraphNodeUpdate once for invoke
      expect(invokeUpdateCalls.length).toBe(1);

      vi.clearAllMocks();

      // Emit multiple messages - should not emit GraphNodeUpdate
      await subscribeFn?.({
        type: 'message',
        data: {
          threadId: 'thread-1',
          messages: [{ content: 'msg1' }],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
            },
          },
        },
      });

      await subscribeFn?.({
        type: 'message',
        data: {
          threadId: 'thread-1',
          messages: [{ content: 'msg2' }],
          config: {
            configurable: {
              graph_id: 'graph-1',
              node_id: 'agent-1',
              parent_thread_id: 'parent-1',
            },
          },
        },
      });

      const messageUpdateCalls = (notifications.emit as any).mock.calls.filter(
        (call: any) => call[0]?.type === NotificationEvent.GraphNodeUpdate,
      );

      // Should NOT emit GraphNodeUpdate for messages
      expect(messageUpdateCalls.length).toBe(0);
    });
  });

  describe('Status queries', () => {
    it('should return snapshots with filters', () => {
      const runtime = new TestRuntime();
      const node: CompiledGraphNode<TestRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: {},
        instance: runtime,
      };

      manager.registerNode('runtime-1');
      manager.attachGraphNode('runtime-1', node);

      const snapshots = manager.getSnapshots('thread-1', 'run-1');
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.id).toBe('runtime-1');
    });
  });

  describe('Cleanup', () => {
    it('should handle destroy cleanup', () => {
      const runtime = new TestRuntime();
      const node: CompiledGraphNode<TestRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        config: {},
        instance: runtime,
      };

      manager.registerNode('runtime-1');
      manager.attachGraphNode('runtime-1', node);

      manager.destroy();

      const snapshots = manager.getSnapshots();
      expect(snapshots).toHaveLength(0); // Nodes are cleared after destroy
    });
  });
});
