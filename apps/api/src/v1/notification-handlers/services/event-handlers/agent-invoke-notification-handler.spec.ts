import { HumanMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphEntity } from '../../../graphs/entity/graph.entity';
import { GraphStatus } from '../../../graphs/graphs.types';
import {
  IAgentInvokeNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import { ThreadStatus } from '../../../threads/threads.types';
import { AgentInvokeNotificationHandler } from './agent-invoke-notification-handler';

describe('AgentInvokeNotificationHandler', () => {
  let handler: AgentInvokeNotificationHandler;
  let threadsDao: ThreadsDao;
  let graphDao: GraphDao;

  const mockUserId = 'user-123';
  const mockGraphId = 'graph-456';
  const mockNodeId = 'node-789';
  const mockThreadId = 'thread-abc';
  const mockParentThreadId = 'parent-thread-def';

  const createMockGraphEntity = (
    overrides: Partial<GraphEntity> = {},
  ): GraphEntity => ({
    id: mockGraphId,
    name: 'Test Graph',
    description: 'A test graph',
    version: '1.0.0',
    schema: {
      nodes: [],
      edges: [],
    },
    status: GraphStatus.Running,
    createdBy: mockUserId,
    temporary: false,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });

  const createMockThreadEntity = (
    overrides: Partial<ThreadEntity> = {},
  ): ThreadEntity => ({
    id: 'thread-internal-123',
    graphId: mockGraphId,
    createdBy: mockUserId,
    externalThreadId: mockThreadId,
    metadata: {},
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    status: ThreadStatus.Running,
    ...overrides,
  });

  const createMockNotification = (
    overrides: Partial<IAgentInvokeNotification> = {},
  ): IAgentInvokeNotification => ({
    type: NotificationEvent.AgentInvoke,
    graphId: mockGraphId,
    nodeId: mockNodeId,
    threadId: mockThreadId,
    parentThreadId: 'parent-thread-123',
    data: {
      messages: [new HumanMessage('Test message')],
    },
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentInvokeNotificationHandler,
        {
          provide: ThreadsDao,
          useValue: {
            getOne: vi.fn(),
            create: vi.fn(),
            updateById: vi.fn(),
          },
        },
        {
          provide: GraphDao,
          useValue: {
            getOne: vi.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get<AgentInvokeNotificationHandler>(
      AgentInvokeNotificationHandler,
    );
    threadsDao = module.get<ThreadsDao>(ThreadsDao);
    graphDao = module.get<GraphDao>(GraphDao);
  });

  describe('handle', () => {
    it('should create a new internal thread when none exists and no parent thread', async () => {
      const mockGraph = createMockGraphEntity();
      const notification = createMockNotification();

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(mockGraph);
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);
      vi.spyOn(threadsDao, 'create').mockResolvedValue(
        createMockThreadEntity(),
      );

      const result = await handler.handle(notification);

      expect(graphDao.getOne).toHaveBeenCalledWith({ id: mockGraphId });
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        externalThreadId: 'parent-thread-123',
        graphId: mockGraphId,
      });
      expect(threadsDao.create).toHaveBeenCalledWith({
        graphId: mockGraphId,
        createdBy: mockUserId,
        externalThreadId: 'parent-thread-123',
        source: undefined,
        status: ThreadStatus.Running,
      });
      expect(result).toEqual([]);
    });

    it('should use parent thread ID for internal thread when provided', async () => {
      const mockGraph = createMockGraphEntity();
      const notification = createMockNotification({
        parentThreadId: mockParentThreadId,
      });

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(mockGraph);
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);
      vi.spyOn(threadsDao, 'create').mockResolvedValue(
        createMockThreadEntity({ externalThreadId: mockParentThreadId }),
      );

      await handler.handle(notification);

      // Should check for internal thread using parent thread ID
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        externalThreadId: mockParentThreadId,
        graphId: mockGraphId,
      });
      // Should create thread with parent thread ID as external ID
      expect(threadsDao.create).toHaveBeenCalledWith({
        graphId: mockGraphId,
        createdBy: mockUserId,
        externalThreadId: mockParentThreadId,
        source: undefined,
        status: ThreadStatus.Running,
      });
    });

    it('should not create thread if internal thread already exists', async () => {
      const mockGraph = createMockGraphEntity();
      const existingThread = createMockThreadEntity();
      const notification = createMockNotification();

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(mockGraph);
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(existingThread);
      vi.spyOn(threadsDao, 'create');
      vi.spyOn(threadsDao, 'updateById');

      await handler.handle(notification);

      expect(threadsDao.getOne).toHaveBeenCalledWith({
        externalThreadId: 'parent-thread-123',
        graphId: mockGraphId,
      });
      expect(threadsDao.create).not.toHaveBeenCalled();
      expect(threadsDao.updateById).not.toHaveBeenCalled();
    });

    it('should reset thread status to running when existing thread is not running', async () => {
      const mockGraph = createMockGraphEntity();
      const existingThread = createMockThreadEntity({
        status: ThreadStatus.NeedMoreInfo,
      });
      const notification = createMockNotification();

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(mockGraph);
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(existingThread);
      const updateSpy = vi
        .spyOn(threadsDao, 'updateById')
        .mockResolvedValue(
          createMockThreadEntity({ status: ThreadStatus.Running }),
        );

      await handler.handle(notification);

      expect(updateSpy).toHaveBeenCalledWith(existingThread.id, {
        status: ThreadStatus.Running,
      });
    });

    it('should skip thread creation if graph not found', async () => {
      const notification = createMockNotification();

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(null);
      vi.spyOn(threadsDao, 'getOne');
      vi.spyOn(threadsDao, 'create');

      const result = await handler.handle(notification);

      expect(graphDao.getOne).toHaveBeenCalledWith({ id: mockGraphId });
      expect(threadsDao.getOne).not.toHaveBeenCalled();
      expect(threadsDao.create).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should create thread with source when provided', async () => {
      const mockGraph = createMockGraphEntity();
      const source = 'manual-trigger (trigger)';
      const notification = createMockNotification({ source });

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(mockGraph);
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);
      vi.spyOn(threadsDao, 'create').mockResolvedValue(
        createMockThreadEntity(),
      );

      const result = await handler.handle(notification);

      expect(graphDao.getOne).toHaveBeenCalledWith({ id: mockGraphId });
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        externalThreadId: 'parent-thread-123',
        graphId: mockGraphId,
      });
      expect(threadsDao.create).toHaveBeenCalledWith({
        graphId: mockGraphId,
        createdBy: mockUserId,
        externalThreadId: 'parent-thread-123',
        source,
        status: ThreadStatus.Running,
      });
      expect(result).toEqual([]);
    });

    it('should handle multiple agents in same execution with same parent thread', async () => {
      const mockGraph = createMockGraphEntity();
      const mockParentThread = createMockThreadEntity({
        externalThreadId: mockParentThreadId,
      });

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(mockGraph);
      vi.spyOn(threadsDao, 'create').mockResolvedValue(mockParentThread);

      // First agent invocation - creates internal thread
      const notification1 = createMockNotification({
        threadId: 'agent1-thread-123',
        parentThreadId: mockParentThreadId,
        nodeId: 'agent-1',
      });
      vi.spyOn(threadsDao, 'getOne').mockResolvedValueOnce(null);
      await handler.handle(notification1);

      expect(threadsDao.create).toHaveBeenCalledTimes(1);
      expect(threadsDao.create).toHaveBeenCalledWith({
        graphId: mockGraphId,
        createdBy: mockUserId,
        externalThreadId: mockParentThreadId,
        status: ThreadStatus.Running,
      });

      // Second agent invocation - should not create new thread
      const notification2 = createMockNotification({
        threadId: 'agent2-thread-456',
        parentThreadId: mockParentThreadId,
        nodeId: 'agent-2',
      });
      vi.spyOn(threadsDao, 'getOne').mockResolvedValueOnce(mockParentThread);
      await handler.handle(notification2);

      // Still only 1 create call
      expect(threadsDao.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('pattern', () => {
    it('should have correct notification pattern', () => {
      expect(handler.pattern).toBe(NotificationEvent.AgentInvoke);
    });
  });
});
