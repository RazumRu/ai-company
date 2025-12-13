import { HumanMessage } from '@langchain/core/messages';
import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphEntity } from '../../../graphs/entity/graph.entity';
import { GraphStatus } from '../../../graphs/graphs.types';
import {
  IAgentInvokeNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import { ThreadsService } from '../../../threads/services/threads.service';
import { ThreadStatus } from '../../../threads/threads.types';
import { AgentInvokeNotificationHandler } from './agent-invoke-notification-handler';

describe('AgentInvokeNotificationHandler', () => {
  let handler: AgentInvokeNotificationHandler;
  let threadsDao: ThreadsDao;
  let graphDao: GraphDao;
  let notificationsService: NotificationsService;
  let moduleRefMock: { create: ReturnType<typeof vi.fn> };

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
    targetVersion: '1.0.0',
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
    lastRunId: undefined,
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
    runId: undefined,
    data: {
      messages: [new HumanMessage('Test message')],
    },
    ...overrides,
  });

  const buildThreadResponseDto = (thread: ThreadEntity) => ({
    id: thread.id,
    graphId: thread.graphId,
    externalThreadId: thread.externalThreadId,
    lastRunId: thread.lastRunId ?? null,
    status: thread.status,
    name: thread.name ?? null,
    source: thread.source ?? null,
    metadata: thread.metadata ?? {},
    createdAt: new Date(thread.createdAt).toISOString(),
    updatedAt: new Date(thread.updatedAt).toISOString(),
  });

  type ThreadResponseDto = ReturnType<typeof buildThreadResponseDto>;
  type ThreadResponseMock = ReturnType<typeof vi.fn> &
    ((thread: ThreadEntity) => ThreadResponseDto);

  let threadsServiceMock: {
    prepareThreadResponse: ThreadResponseMock;
  };

  beforeEach(async () => {
    threadsServiceMock = {
      prepareThreadResponse: vi.fn(buildThreadResponseDto),
    };

    moduleRefMock = {
      create: vi.fn().mockResolvedValue(threadsServiceMock),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentInvokeNotificationHandler,
        {
          provide: ThreadsDao,
          useValue: {
            getOne: vi.fn(),
            create: vi.fn(),
            updateById: vi.fn(),
            touchById: vi.fn(),
          },
        },
        {
          provide: GraphDao,
          useValue: {
            getOne: vi.fn(),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            emit: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ModuleRef,
          useValue: moduleRefMock,
        },
      ],
    }).compile();

    handler = module.get<AgentInvokeNotificationHandler>(
      AgentInvokeNotificationHandler,
    );
    threadsDao = module.get<ThreadsDao>(ThreadsDao);
    graphDao = module.get<GraphDao>(GraphDao);
    notificationsService =
      module.get<NotificationsService>(NotificationsService);
  });

  describe('handle', () => {
    it('should create a new internal thread when none exists and no parent thread', async () => {
      const mockGraph = createMockGraphEntity();
      const notification = createMockNotification({
        runId: '11111111-1111-4111-8aaa-111111111111',
      });
      const createdThread = createMockThreadEntity();

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(mockGraph);
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);
      vi.spyOn(threadsDao, 'create').mockResolvedValue(createdThread);

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
        lastRunId: '11111111-1111-4111-8aaa-111111111111',
      });
      expect(notificationsService.emit).toHaveBeenCalledWith({
        type: NotificationEvent.ThreadCreate,
        graphId: mockGraphId,
        threadId: 'parent-thread-123',
        internalThreadId: createdThread.id,
        data: createdThread,
      });
      expect(result).toEqual([]);
    });

    it('should use parent thread ID for internal thread when provided', async () => {
      const mockGraph = createMockGraphEntity();
      const notification = createMockNotification({
        parentThreadId: mockParentThreadId,
        runId: '22222222-2222-4222-8aaa-222222222222',
      });
      const createdThread = createMockThreadEntity({
        externalThreadId: mockParentThreadId,
      });

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(mockGraph);
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);
      vi.spyOn(threadsDao, 'create').mockResolvedValue(createdThread);

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
        lastRunId: '22222222-2222-4222-8aaa-222222222222',
      });
      expect(notificationsService.emit).toHaveBeenCalledWith({
        type: NotificationEvent.ThreadCreate,
        graphId: mockGraphId,
        threadId: mockParentThreadId,
        internalThreadId: createdThread.id,
        data: createdThread,
      });
    });

    it('should touch existing thread when internal thread already exists', async () => {
      const mockGraph = createMockGraphEntity();
      const existingThread = createMockThreadEntity();
      const notification = createMockNotification({
        runId: existingThread.lastRunId,
      });

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(mockGraph);
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(existingThread);
      vi.spyOn(threadsDao, 'create');
      vi.spyOn(threadsDao, 'updateById');
      const touchSpy = vi.spyOn(threadsDao, 'touchById');

      await handler.handle(notification);

      expect(threadsDao.getOne).toHaveBeenCalledWith({
        externalThreadId: 'parent-thread-123',
        graphId: mockGraphId,
      });
      expect(threadsDao.create).not.toHaveBeenCalled();
      expect(threadsDao.updateById).not.toHaveBeenCalled();
      expect(touchSpy).toHaveBeenCalledWith(existingThread.id);
      expect(moduleRefMock.create).not.toHaveBeenCalled();
      expect(notificationsService.emit).not.toHaveBeenCalled();
    });

    it('should reset thread status to running when existing thread is not running', async () => {
      const mockGraph = createMockGraphEntity();
      const existingThread = createMockThreadEntity({
        status: ThreadStatus.NeedMoreInfo,
      });
      const updatedThread = createMockThreadEntity({
        status: ThreadStatus.Running,
        updatedAt: new Date('2024-01-01T00:00:01Z'),
      });
      const notification = createMockNotification({
        runId: '33333333-3333-4333-8aaa-333333333333',
      });

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(mockGraph);
      const getOneSpy = vi
        .spyOn(threadsDao, 'getOne')
        .mockResolvedValueOnce(existingThread)
        .mockResolvedValueOnce(updatedThread);
      const updateSpy = vi
        .spyOn(threadsDao, 'updateById')
        .mockResolvedValue(updatedThread);

      const expectedThreadDto =
        threadsServiceMock.prepareThreadResponse(updatedThread);
      threadsServiceMock.prepareThreadResponse.mockClear();
      moduleRefMock.create.mockClear();

      await handler.handle(notification);

      expect(updateSpy).toHaveBeenCalledWith(existingThread.id, {
        status: ThreadStatus.Running,
        lastRunId: '33333333-3333-4333-8aaa-333333333333',
      });
      expect(getOneSpy).toHaveBeenNthCalledWith(2, {
        id: existingThread.id,
        graphId: mockGraphId,
      });
      expect(moduleRefMock.create).toHaveBeenCalledWith(ThreadsService);
      expect(threadsServiceMock.prepareThreadResponse).toHaveBeenCalledWith(
        updatedThread,
      );
      expect(threadsDao.touchById).not.toHaveBeenCalled();
      expect(notificationsService.emit).toHaveBeenCalledWith({
        type: NotificationEvent.ThreadUpdate,
        graphId: mockGraphId,
        threadId: 'parent-thread-123',
        parentThreadId: 'parent-thread-123',
        data: expectedThreadDto,
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
      const createdThread = createMockThreadEntity();

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(mockGraph);
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);
      vi.spyOn(threadsDao, 'create').mockResolvedValue(createdThread);

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
      expect(notificationsService.emit).toHaveBeenCalledWith({
        type: NotificationEvent.ThreadCreate,
        graphId: mockGraphId,
        threadId: 'parent-thread-123',
        internalThreadId: createdThread.id,
        data: createdThread,
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
      expect(notificationsService.emit).toHaveBeenCalledTimes(1);

      // Second agent invocation - should not create new thread
      const notification2 = createMockNotification({
        threadId: 'agent2-thread-456',
        parentThreadId: mockParentThreadId,
        nodeId: 'agent-2',
      });
      vi.spyOn(threadsDao, 'getOne').mockResolvedValueOnce(mockParentThread);
      await handler.handle(notification2);

      // Still only 1 create call and 1 emit call
      expect(threadsDao.create).toHaveBeenCalledTimes(1);
      expect(notificationsService.emit).toHaveBeenCalledTimes(1);
    });
  });

  describe('pattern', () => {
    it('should have correct notification pattern', () => {
      expect(handler.pattern).toBe(NotificationEvent.AgentInvoke);
    });
  });
});
