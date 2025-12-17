import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ThreadTokenUsageCacheService } from '../../../cache/services/thread-token-usage-cache.service';
import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphEntity } from '../../../graphs/entity/graph.entity';
import { GraphStatus } from '../../../graphs/graphs.types';
import {
  IThreadUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadDto } from '../../../threads/dto/threads.dto';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import { ThreadsService } from '../../../threads/services/threads.service';
import { ThreadStatus } from '../../../threads/threads.types';
import {
  EnrichedNotificationEvent,
  NotificationScope,
} from '../../notification-handlers.types';
import {
  IThreadUpdateEnrichedNotification,
  ThreadUpdateNotificationHandler,
} from './thread-update-notification-handler';

describe('ThreadUpdateNotificationHandler', () => {
  let handler: ThreadUpdateNotificationHandler;
  let threadsDao: ThreadsDao;
  let graphDao: GraphDao;
  let moduleRefMock: { create: ReturnType<typeof vi.fn> };
  let threadsServiceMock: {
    prepareThreadResponse: ReturnType<typeof vi.fn>;
  };
  let threadDtoFactory: (thread: ThreadEntity) => ThreadDto;

  const mockGraphId = '22222222-2222-4222-8aaa-222222222222';
  const mockOwnerId = 'user-123';
  const mockThreadId = 'external-thread-123';

  const createMockThreadEntity = (
    overrides: Partial<ThreadEntity> = {},
  ): ThreadEntity => ({
    id: '11111111-1111-4111-8aaa-111111111111',
    graphId: mockGraphId,
    createdBy: mockOwnerId,
    externalThreadId: mockThreadId,
    metadata: {},
    source: undefined,
    name: 'Thread Name',
    status: ThreadStatus.Running,
    lastRunId: undefined,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });

  const createMockNotification = (
    overrides: Partial<IThreadUpdateNotification> = {},
  ): IThreadUpdateNotification => ({
    type: NotificationEvent.ThreadUpdate,
    graphId: mockGraphId,
    threadId: mockThreadId,
    data: {},
    ...overrides,
  });

  beforeEach(async () => {
    const mockGraph: GraphEntity = {
      id: mockGraphId,
      createdBy: mockOwnerId,
      name: 'Graph',
      description: 'Desc',
      version: '1.0.0',
      targetVersion: '1.0.0',
      schema: { nodes: [], edges: [] },
      status: GraphStatus.Created,
      temporary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      error: undefined,
    };

    threadDtoFactory = (thread: ThreadEntity): ThreadDto => ({
      id: thread.id,
      graphId: thread.graphId,
      externalThreadId: thread.externalThreadId,
      lastRunId: thread.lastRunId ?? null,
      status: thread.status,
      name: thread.name ?? null,
      source: thread.source ?? null,
      metadata: thread.metadata ?? {},
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
    });

    threadsServiceMock = {
      prepareThreadResponse: vi
        .fn<(entity: ThreadEntity) => ThreadDto>()
        .mockImplementation(threadDtoFactory),
    };

    moduleRefMock = {
      create: vi.fn().mockResolvedValue(threadsServiceMock),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadUpdateNotificationHandler,
        {
          provide: ThreadsDao,
          useValue: {
            getOne: vi.fn(),
            updateById: vi.fn(),
          },
        },
        {
          provide: GraphDao,
          useValue: {
            getOne: vi.fn().mockResolvedValue(mockGraph),
          },
        },
        {
          provide: ModuleRef,
          useValue: moduleRefMock,
        },
        {
          provide: ThreadTokenUsageCacheService,
          useValue: {
            getThreadTokenUsage: vi.fn().mockResolvedValue(null),
            getMultipleThreadTokenUsage: vi.fn().mockResolvedValue(new Map()),
            setThreadTokenUsage: vi.fn().mockResolvedValue(undefined),
            flushThreadTokenUsage: vi.fn().mockResolvedValue(null),
            deleteThreadTokenUsage: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    handler = module.get<ThreadUpdateNotificationHandler>(
      ThreadUpdateNotificationHandler,
    );
    threadsDao = module.get<ThreadsDao>(ThreadsDao);
    graphDao = module.get<GraphDao>(GraphDao);
  });

  const expectFullThreadPayload = (
    result: IThreadUpdateEnrichedNotification[],
    thread: ThreadEntity,
  ) => {
    expect(moduleRefMock.create).toHaveBeenCalledWith(ThreadsService);
    expect(threadsServiceMock.prepareThreadResponse).toHaveBeenCalledWith(
      thread,
    );

    const expectedThread = threadDtoFactory(thread);

    expect(result).toEqual([
      {
        type: EnrichedNotificationEvent.ThreadUpdate,
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        threadId: mockThreadId,
        internalThreadId: thread.id,
        scope: [NotificationScope.Graph],
        data: expectedThread,
      },
    ]);
  };

  describe('handle', () => {
    it('updates status and emits full thread info', async () => {
      const thread = createMockThreadEntity({ status: ThreadStatus.Running });
      const updatedThread = {
        ...thread,
        status: ThreadStatus.Stopped,
        updatedAt: new Date('2024-01-01T00:00:01Z'),
      } satisfies ThreadEntity;
      const notification = createMockNotification({
        data: { status: ThreadStatus.Stopped },
      });

      const getOneSpy = vi
        .spyOn(threadsDao, 'getOne')
        .mockResolvedValueOnce(thread)
        .mockResolvedValueOnce(updatedThread);
      const updateSpy = vi
        .spyOn(threadsDao, 'updateById')
        .mockResolvedValue(updatedThread);

      const result = await handler.handle(notification);

      expect(graphDao.getOne).toHaveBeenCalledWith({ id: mockGraphId });
      expect(getOneSpy).toHaveBeenNthCalledWith(1, {
        externalThreadId: mockThreadId,
        graphId: mockGraphId,
      });
      expect(updateSpy).toHaveBeenCalledWith(thread.id, {
        status: ThreadStatus.Stopped,
      });
      expect(getOneSpy).toHaveBeenNthCalledWith(2, {
        id: thread.id,
        graphId: mockGraphId,
      });
      expectFullThreadPayload(result, updatedThread);
    });

    it('sets name when thread has no name yet', async () => {
      const thread = createMockThreadEntity({ name: undefined });
      const updatedThread = {
        ...thread,
        name: 'New Name',
        updatedAt: new Date('2024-01-01T00:00:01Z'),
      } satisfies ThreadEntity;
      const notification = createMockNotification({
        data: { name: 'New Name' },
      });

      const getOneSpy = vi
        .spyOn(threadsDao, 'getOne')
        .mockResolvedValueOnce(thread)
        .mockResolvedValueOnce(updatedThread);
      vi.spyOn(threadsDao, 'updateById').mockResolvedValue(updatedThread);

      const result = await handler.handle(notification);

      expect(getOneSpy).toHaveBeenNthCalledWith(1, {
        externalThreadId: mockThreadId,
        graphId: mockGraphId,
      });
      expect(threadsDao.updateById).toHaveBeenCalledWith(thread.id, {
        name: 'New Name',
      });
      expect(getOneSpy).toHaveBeenNthCalledWith(2, {
        id: thread.id,
        graphId: mockGraphId,
      });
      expectFullThreadPayload(result, updatedThread);
    });

    it('does not update name when thread already has a name', async () => {
      const thread = createMockThreadEntity({ name: 'Existing Name' });
      const notification = createMockNotification({
        data: { name: 'New Name Attempt' },
      });

      vi.spyOn(threadsDao, 'getOne')
        .mockResolvedValueOnce(thread)
        .mockResolvedValueOnce(thread);
      const updateSpy = vi.spyOn(threadsDao, 'updateById');

      const result = await handler.handle(notification);

      expect(updateSpy).not.toHaveBeenCalled();
      expectFullThreadPayload(result, thread);
    });

    it('emits full thread when no fields provided', async () => {
      const thread = createMockThreadEntity();
      const notification = createMockNotification({ data: {} });

      vi.spyOn(threadsDao, 'getOne')
        .mockResolvedValueOnce(thread)
        .mockResolvedValueOnce(thread);
      const updateSpy = vi.spyOn(threadsDao, 'updateById');

      const result = await handler.handle(notification);

      expect(updateSpy).not.toHaveBeenCalled();
      expectFullThreadPayload(result, thread);
    });

    it('returns empty array when thread not found', async () => {
      const notification = createMockNotification({
        data: { status: ThreadStatus.Stopped },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      const result = await handler.handle(notification);

      expect(result).toEqual([]);
    });
  });
});
