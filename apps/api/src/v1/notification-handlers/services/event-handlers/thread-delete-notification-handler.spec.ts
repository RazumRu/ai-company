import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphEntity } from '../../../graphs/entity/graph.entity';
import { GraphStatus } from '../../../graphs/graphs.types';
import {
  IThreadDeleteNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadDto } from '../../../threads/dto/threads.dto';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import { ThreadsService } from '../../../threads/services/threads.service';
import { ThreadStatus } from '../../../threads/threads.types';
import {
  EnrichedNotificationEvent,
  NotificationScope,
} from '../../notification-handlers.types';
import {
  IThreadDeleteEnrichedNotification,
  ThreadDeleteNotificationHandler,
} from './thread-delete-notification-handler';

const toThreadDto = (entity: ThreadEntity): ThreadDto => ({
  id: entity.id,
  graphId: entity.graphId,
  externalThreadId: entity.externalThreadId,
  createdAt: entity.createdAt.toISOString(),
  updatedAt: entity.updatedAt.toISOString(),
  metadata: entity.metadata ?? {},
  source: entity.source ?? null,
  name: entity.name ?? null,
  status: entity.status,
});

describe('ThreadDeleteNotificationHandler', () => {
  let handler: ThreadDeleteNotificationHandler;
  let graphDao: GraphDao;
  let moduleRefMock: { create: ReturnType<typeof vi.fn> };
  let threadsServiceMock: {
    prepareThreadResponse: ReturnType<typeof vi.fn>;
  };

  const mockGraphId = '22222222-2222-4222-8aaa-222222222222';
  const mockOwnerId = 'user-123';
  const mockThreadId = 'external-thread-123';
  const mockInternalThreadId = '11111111-1111-4111-8aaa-111111111111';

  const createMockThreadEntity = (
    overrides: Partial<ThreadEntity> = {},
  ): ThreadEntity => ({
    id: mockInternalThreadId,
    graphId: mockGraphId,
    createdBy: mockOwnerId,
    externalThreadId: mockThreadId,
    metadata: {},
    source: undefined,
    name: undefined,
    status: ThreadStatus.Running,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });

  const createMockNotification = (
    overrides: Partial<IThreadDeleteNotification> = {},
  ): IThreadDeleteNotification => ({
    type: NotificationEvent.ThreadDelete,
    graphId: mockGraphId,
    threadId: mockThreadId,
    internalThreadId: mockInternalThreadId,
    data: createMockThreadEntity(),
    ...overrides,
  });

  beforeEach(async () => {
    const mockGraph: GraphEntity = {
      id: mockGraphId,
      createdBy: mockOwnerId,
      name: 'Graph',
      description: 'Desc',
      version: '1.0.0',
      schema: { nodes: [], edges: [] },
      status: GraphStatus.Created,
      temporary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      error: undefined,
    };

    threadsServiceMock = {
      prepareThreadResponse: vi
        .fn<(entity: ThreadEntity) => ThreadDto>()
        .mockImplementation((entity: ThreadEntity) => toThreadDto(entity)),
    };

    moduleRefMock = {
      create: vi.fn().mockResolvedValue(threadsServiceMock),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadDeleteNotificationHandler,
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
      ],
    }).compile();

    handler = module.get<ThreadDeleteNotificationHandler>(
      ThreadDeleteNotificationHandler,
    );
    graphDao = module.get<GraphDao>(GraphDao);
  });

  const expectThreadPayload = (
    result: IThreadDeleteEnrichedNotification[],
    threadEntity: ThreadEntity,
  ) => {
    const expectedDto = toThreadDto(threadEntity);

    expect(moduleRefMock.create).toHaveBeenCalledWith(ThreadsService);
    expect(threadsServiceMock.prepareThreadResponse).toHaveBeenCalledWith(
      threadEntity,
    );

    expect(result).toHaveLength(1);
    const firstResult = result[0]!;

    expect(firstResult).toEqual({
      type: EnrichedNotificationEvent.ThreadDelete,
      graphId: mockGraphId,
      ownerId: mockOwnerId,
      threadId: mockThreadId,
      internalThreadId: expectedDto.id,
      scope: [NotificationScope.Graph],
      data: expectedDto,
    });
  };

  describe('handle', () => {
    it('emits full thread info for deleted thread', async () => {
      const thread = createMockThreadEntity();
      const notification = createMockNotification({ data: thread });

      const result = await handler.handle(notification);

      expect(graphDao.getOne).toHaveBeenCalledWith({ id: mockGraphId });
      expectThreadPayload(result, thread);
    });

    it('throws error when graph not found', async () => {
      const notification = createMockNotification();

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(null);

      await expect(handler.handle(notification)).rejects.toThrow(
        'GRAPH_NOT_FOUND',
      );
      expect(moduleRefMock.create).not.toHaveBeenCalled();
    });
  });

  describe('pattern', () => {
    it('should have correct notification pattern', () => {
      expect(handler.pattern).toBe(NotificationEvent.ThreadDelete);
    });
  });
});
