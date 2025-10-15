import type { RunnableConfig } from '@langchain/core/runnables';
import type {
  Checkpoint,
  CheckpointMetadata,
  PendingWrite,
} from '@langchain/langgraph-checkpoint';
import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { GraphCheckpointsDao } from '../dao/graph-checkpoints.dao';
import { GraphCheckpointsWritesDao } from '../dao/graph-checkpoints-writes.dao';
import { PgCheckpointSaver } from './pg-checkpoint-saver';

describe('PgCheckpointSaver', () => {
  let service: PgCheckpointSaver;
  let mockGraphCheckpointsDao: any;
  let mockGraphCheckpointsWritesDao: any;
  let mockNotificationsService: any;

  beforeEach(async () => {
    mockGraphCheckpointsDao = {
      getOne: vi.fn(),
      create: vi.fn(),
      updateById: vi.fn(),
      getAll: vi.fn(),
      hardDelete: vi.fn(),
    };

    mockGraphCheckpointsWritesDao = {
      getAll: vi.fn(),
      getOne: vi.fn(),
      create: vi.fn(),
      updateById: vi.fn(),
      hardDelete: vi.fn(),
    };

    mockNotificationsService = {
      emit: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PgCheckpointSaver,
        {
          provide: GraphCheckpointsDao,
          useValue: mockGraphCheckpointsDao,
        },
        {
          provide: GraphCheckpointsWritesDao,
          useValue: mockGraphCheckpointsWritesDao,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    service = await module.resolve<PgCheckpointSaver>(PgCheckpointSaver);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('put', () => {
    it('should emit checkpointer notification with correct metadata', async () => {
      const config: RunnableConfig = {
        configurable: {
          thread_id: 'test-thread-123',
          graph_id: 'test-graph-456',
          node_id: 'test-node-789',
          checkpoint_ns: 'test-ns',
        },
      };

      const checkpoint: Checkpoint = {
        id: 'checkpoint-123',
        ts: '2024-01-01T00:00:00Z',
        channel_values: {
          messages: [{ content: 'Hello', type: 'human' }],
        },
        channel_versions: {},
        versions_seen: {
          'node-1': {
            v: 1,
          },
        },
        v: 1,
      };

      const metadata: CheckpointMetadata = {
        source: 'input',
        step: 1,
        parents: {},
      };

      mockGraphCheckpointsDao.getOne.mockResolvedValue(null);
      mockGraphCheckpointsDao.create.mockResolvedValue({ id: 'db-id' });

      await service.put(config, checkpoint, metadata);

      expect(mockNotificationsService.emit).toHaveBeenCalledWith({
        type: NotificationEvent.Checkpointer,
        graphId: 'test-graph-456',
        nodeId: 'test-node-789',
        threadId: 'test-thread-123',
        data: {
          messages: [
            expect.objectContaining({
              content: 'Hello',
            }),
          ],
        },
      });
    });

    it('should not emit notification when graph_id is missing and no messages', async () => {
      const config: RunnableConfig = {
        configurable: {
          thread_id: 'test-thread-123',
          node_id: 'test-node-789',
          checkpoint_ns: 'test-ns',
        },
      };

      const checkpoint: Checkpoint = {
        id: 'checkpoint-123',
        ts: '2024-01-01T00:00:00Z',
        channel_values: {},
        channel_versions: {},
        versions_seen: {},
        v: 1,
      };

      const metadata: CheckpointMetadata = {
        source: 'input',
        step: 1,
        parents: {},
      };

      mockGraphCheckpointsDao.getOne.mockResolvedValue(null);
      mockGraphCheckpointsDao.create.mockResolvedValue({ id: 'db-id' });

      await service.put(config, checkpoint, metadata);

      // No messages in checkpoint, so no notification should be emitted
      expect(mockNotificationsService.emit).not.toHaveBeenCalled();
    });

    it('should not emit notification when node_id is missing and no messages', async () => {
      const config: RunnableConfig = {
        configurable: {
          thread_id: 'test-thread-123',
          graph_id: 'test-graph-456',
          checkpoint_ns: 'test-ns',
        },
      };

      const checkpoint: Checkpoint = {
        id: 'checkpoint-123',
        ts: '2024-01-01T00:00:00Z',
        channel_values: {},
        channel_versions: {},
        versions_seen: {},
        v: 1,
      };

      const metadata: CheckpointMetadata = {
        source: 'input',
        step: 1,
        parents: {},
      };

      mockGraphCheckpointsDao.getOne.mockResolvedValue(null);
      mockGraphCheckpointsDao.create.mockResolvedValue({ id: 'db-id' });

      await service.put(config, checkpoint, metadata);

      // No messages in checkpoint, so no notification should be emitted
      expect(mockNotificationsService.emit).not.toHaveBeenCalled();
    });
  });

  describe('putWrites', () => {
    it('should emit checkpointer notification with extracted messages from writes', async () => {
      const config: RunnableConfig = {
        configurable: {
          thread_id: 'test-thread-123',
          graph_id: 'test-graph-456',
          node_id: 'test-node-789',
          checkpoint_ns: 'test-ns',
          checkpoint_id: 'checkpoint-123',
        },
      };

      const writes: PendingWrite[] = [
        ['messages', { content: 'Hello world', type: 'human' }],
        ['tools', { name: 'search', args: { query: 'test' } }],
        ['state', { currentStep: 1, status: 'running' }],
      ];

      const taskId = 'task-123';

      mockGraphCheckpointsWritesDao.getOne.mockResolvedValue(null);
      mockGraphCheckpointsWritesDao.create.mockResolvedValue({ id: 'db-id' });

      await service.putWrites(config, writes, taskId);

      expect(mockNotificationsService.emit).toHaveBeenCalledWith({
        type: NotificationEvent.Checkpointer,
        graphId: 'test-graph-456',
        nodeId: 'test-node-789',
        threadId: 'test-thread-123',
        data: {
          messages: [
            expect.objectContaining({
              content: 'Hello world',
            }),
          ],
        },
      });
    });

    it('should not emit notification for non-message writes', async () => {
      const config: RunnableConfig = {
        configurable: {
          thread_id: 'test-thread-123',
          graph_id: 'test-graph-456',
          node_id: 'test-node-789',
          checkpoint_ns: 'test-ns',
          checkpoint_id: 'checkpoint-123',
        },
      };

      const toolCallWrite: PendingWrite = [
        'tools',
        {
          name: 'web_search',
          args: { query: 'latest AI news' },
          id: 'tool-call-123',
          type: 'tool_call',
        },
      ];

      const writes: PendingWrite[] = [toolCallWrite];
      const taskId = 'task-123';

      mockGraphCheckpointsWritesDao.getOne.mockResolvedValue(null);
      mockGraphCheckpointsWritesDao.create.mockResolvedValue({ id: 'db-id' });

      await service.putWrites(config, writes, taskId);

      // No BaseMessage objects in writes, so no notification should be emitted
      expect(mockNotificationsService.emit).not.toHaveBeenCalled();
    });

    it('should handle message writes correctly', async () => {
      const config: RunnableConfig = {
        configurable: {
          thread_id: 'test-thread-123',
          graph_id: 'test-graph-456',
          node_id: 'test-node-789',
          checkpoint_ns: 'test-ns',
          checkpoint_id: 'checkpoint-123',
        },
      };

      const messageWrite: PendingWrite = [
        'messages',
        {
          content: 'I need to search for information about AI',
          type: 'human',
          id: 'msg-123',
        },
      ];

      const writes: PendingWrite[] = [messageWrite];
      const taskId = 'task-123';

      mockGraphCheckpointsWritesDao.getOne.mockResolvedValue(null);
      mockGraphCheckpointsWritesDao.create.mockResolvedValue({ id: 'db-id' });

      await service.putWrites(config, writes, taskId);

      expect(mockNotificationsService.emit).toHaveBeenCalledWith({
        type: NotificationEvent.Checkpointer,
        graphId: 'test-graph-456',
        nodeId: 'test-node-789',
        threadId: 'test-thread-123',
        data: {
          messages: [
            expect.objectContaining({
              content: 'I need to search for information about AI',
              id: 'msg-123',
            }),
          ],
        },
      });
    });
  });

  describe('Notifications Integration', () => {
    let capturedNotifications: any[] = [];

    beforeEach(() => {
      // Capture all notifications
      capturedNotifications = [];
      mockNotificationsService.emit = vi.fn((notification) => {
        capturedNotifications.push(notification);
      });
    });

    describe('End-to-End Metadata Flow', () => {
      it('should capture checkpointer notifications with complete metadata', async () => {
        const config: RunnableConfig = {
          configurable: {
            thread_id: 'integration-thread-123',
            graph_id: 'integration-graph-456',
            node_id: 'integration-node-789',
            checkpoint_ns: 'integration-ns',
          },
        };

        const checkpoint: Checkpoint = {
          id: 'integration-checkpoint-123',
          ts: '2024-01-01T00:00:00Z',
          channel_values: {
            messages: [
              { content: 'Hello, I need help with AI research', type: 'human' },
              {
                content:
                  'I can help you with AI research. Let me search for the latest information.',
                type: 'ai',
              },
            ],
          },
          channel_versions: {},
          versions_seen: {
            'agent-node': {
              v: 1,
            },
            'search-tool-node': {
              v: 1,
            },
          },
          v: 1,
        };

        const metadata: CheckpointMetadata = {
          source: 'input',
          step: 1,
          parents: {},
        };

        mockGraphCheckpointsDao.getOne.mockResolvedValue(null);
        mockGraphCheckpointsDao.create.mockResolvedValue({ id: 'db-id' });

        await service.put(config, checkpoint, metadata);

        // Verify notification was captured
        expect(capturedNotifications).toHaveLength(1);

        const notification = capturedNotifications[0];
        expect(notification.type).toBe(NotificationEvent.Checkpointer);
        expect(notification.graphId).toBe('integration-graph-456');
        expect(notification.nodeId).toBe('integration-node-789');
        expect(notification.threadId).toBe('integration-thread-123');
        expect(notification.data.messages).toBeDefined();
        expect(notification.data.messages.length).toBeGreaterThan(0);
        // Verify at least one message was extracted
        expect(notification.data.messages[0].content).toBeDefined();
      });

      it('should capture tool call notifications with writes data', async () => {
        const config: RunnableConfig = {
          configurable: {
            thread_id: 'integration-thread-123',
            graph_id: 'integration-graph-456',
            node_id: 'search-tool-node',
            checkpoint_ns: 'integration-ns',
            checkpoint_id: 'integration-checkpoint-123',
          },
        };

        const writes: PendingWrite[] = [
          [
            'tools',
            {
              name: 'web_search',
              args: { query: 'latest AI research papers 2024' },
              id: 'tool-call-123',
              type: 'tool_call',
            },
          ],
          [
            'messages',
            {
              content:
                'I found some recent AI research papers. Here are the key findings...',
              type: 'ai',
              id: 'msg-456',
            },
          ],
        ];

        const taskId = 'task-789';

        mockGraphCheckpointsWritesDao.getOne.mockResolvedValue(null);
        mockGraphCheckpointsWritesDao.create.mockResolvedValue({ id: 'db-id' });

        await service.putWrites(config, writes, taskId);

        // Verify notification was captured
        expect(capturedNotifications).toHaveLength(1);

        const notification = capturedNotifications[0];
        expect(notification.type).toBe(NotificationEvent.Checkpointer);
        expect(notification.graphId).toBe('integration-graph-456');
        expect(notification.nodeId).toBe('search-tool-node');
        expect(notification.threadId).toBe('integration-thread-123');
        expect(notification.data.messages).toBeDefined();
        // Only AI message should be extracted (tool call is not a BaseMessage)
        expect(notification.data.messages).toHaveLength(1);
        expect(notification.data.messages[0].content).toBe(
          'I found some recent AI research papers. Here are the key findings...',
        );
      });

      it('should handle multiple sequential notifications', async () => {
        const configs = [
          {
            configurable: {
              thread_id: 'thread-1',
              graph_id: 'graph-1',
              node_id: 'node-1',
              checkpoint_ns: 'ns-1',
            },
          },
          {
            configurable: {
              thread_id: 'thread-2',
              graph_id: 'graph-2',
              node_id: 'node-2',
              checkpoint_ns: 'ns-2',
            },
          },
        ];

        const checkpoints: Checkpoint[] = [
          {
            id: 'checkpoint-1',
            ts: '2024-01-01T00:00:00Z',
            channel_values: {
              messages: [{ content: 'Message 1', type: 'human' }],
            },
            channel_versions: {},
            versions_seen: {
              'node-1': {
                v: 1,
              },
            },
            v: 1,
          },
          {
            id: 'checkpoint-2',
            ts: '2024-01-01T00:01:00Z',
            channel_values: {
              messages: [{ content: 'Message 2', type: 'human' }],
            },
            channel_versions: {},
            versions_seen: {
              'node-2': {
                v: 1,
              },
            },
            v: 1,
          },
        ];

        const metadata: CheckpointMetadata[] = [
          { source: 'input', step: 1, parents: {} },
          { source: 'input', step: 2, parents: {} },
        ];

        mockGraphCheckpointsDao.getOne.mockResolvedValue(null);
        mockGraphCheckpointsDao.create.mockResolvedValue({ id: 'db-id' });

        // Send multiple notifications
        for (let i = 0; i < configs.length; i++) {
          await service.put(configs[i]!, checkpoints[i]!, metadata[i]!);
        }

        // Verify all notifications were captured
        expect(capturedNotifications).toHaveLength(2);

        // Verify first notification
        expect(capturedNotifications[0].graphId).toBe('graph-1');
        expect(capturedNotifications[0].nodeId).toBe('node-1');
        expect(capturedNotifications[0].threadId).toBe('thread-1');

        // Verify second notification
        expect(capturedNotifications[1].graphId).toBe('graph-2');
        expect(capturedNotifications[1].nodeId).toBe('node-2');
        expect(capturedNotifications[1].threadId).toBe('thread-2');
      });

      it('should handle missing metadata gracefully', async () => {
        const config: RunnableConfig = {
          configurable: {
            thread_id: 'thread-without-metadata',
            checkpoint_ns: 'ns',
          },
        };

        const checkpoint: Checkpoint = {
          id: 'checkpoint-without-metadata',
          ts: '2024-01-01T00:00:00Z',
          channel_values: {},
          channel_versions: {},
          versions_seen: {},
          v: 1,
        };

        const metadata: CheckpointMetadata = {
          source: 'input',
          step: 1,
          parents: {},
        };

        mockGraphCheckpointsDao.getOne.mockResolvedValue(null);
        mockGraphCheckpointsDao.create.mockResolvedValue({ id: 'db-id' });

        await service.put(config, checkpoint, metadata);

        // No messages in checkpoint, so no notification should be emitted
        expect(capturedNotifications).toHaveLength(0);
      });
    });
  });
});
