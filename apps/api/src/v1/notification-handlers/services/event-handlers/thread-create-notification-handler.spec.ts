import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphEntity } from '../../../graphs/entity/graph.entity';
import { GraphStatus } from '../../../graphs/graphs.types';
import {
  IThreadCreateNotification,
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
  IThreadCreateEnrichedNotification,
  ThreadCreateNotificationHandler,
} from './thread-create-notification-handler';

describe('ThreadCreateNotificationHandler', () => {
  let handler: ThreadCreateNotificationHandler;
  let graphDao: GraphDao;

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
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    metadata: {},
    source: undefined,
    name: undefined,
    status: ThreadStatus.Running,
    ...overrides,
  });

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

  const createMockNotification = (
    overrides: Partial<IThreadCreateNotification> = {},
  ): IThreadCreateNotification => ({
    type: NotificationEvent.ThreadCreate,
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadCreateNotificationHandler,
        {
          provide: GraphDao,
          useValue: {
            getOne: vi.fn().mockResolvedValue(mockGraph),
          },
        },
        {
          provide: ThreadsService,
          useValue: {
            prepareThreadResponse: vi
              .fn<(entity: ThreadEntity) => ThreadDto>()
              .mockImplementation((entity: ThreadEntity) =>
                toThreadDto(entity),
              ),
          },
        },
      ],
    }).compile();

    handler = module.get<ThreadCreateNotificationHandler>(
      ThreadCreateNotificationHandler,
    );
    graphDao = module.get<GraphDao>(GraphDao);
  });

  const expectThreadPayload = (
    result: IThreadCreateEnrichedNotification[],
    threadEntity: ThreadEntity,
  ) => {
    const expectedDto = toThreadDto(threadEntity);

    expect(result).toHaveLength(1);
    const firstResult = result[0]!;

    expect(firstResult).toEqual({
      type: EnrichedNotificationEvent.ThreadCreate,
      graphId: mockGraphId,
      ownerId: mockOwnerId,
      threadId: mockThreadId,
      internalThreadId: expectedDto.id,
      scope: [NotificationScope.Graph],
      data: expectedDto,
    });
  };

  describe('handle', () => {
    it('emits full thread info for newly created thread', async () => {
      const thread = createMockThreadEntity();
      const notification = createMockNotification({ data: thread });

      const result = await handler.handle(notification);

      expect(graphDao.getOne).toHaveBeenCalledWith({ id: mockGraphId });
      expectThreadPayload(result, thread);
    });

    it('includes source when thread has source', async () => {
      const thread = createMockThreadEntity({
        source: 'manual-trigger (trigger)',
      });
      const notification = createMockNotification({ data: thread });

      const result = await handler.handle(notification);

      const firstResult = result[0]!;
      expect(firstResult.data.source).toBe('manual-trigger (trigger)');
      expectThreadPayload(result, thread);
    });

    it('includes name when thread has name', async () => {
      const thread = createMockThreadEntity({ name: 'Thread Name' });
      const notification = createMockNotification({ data: thread });

      const result = await handler.handle(notification);

      const firstResult = result[0]!;
      expect(firstResult.data.name).toBe('Thread Name');
      expectThreadPayload(result, thread);
    });

    it('throws error when graph not found', async () => {
      const notification = createMockNotification();

      vi.spyOn(graphDao, 'getOne').mockResolvedValue(null);

      await expect(handler.handle(notification)).rejects.toThrow(
        'GRAPH_NOT_FOUND',
      );
    });

    it('includes metadata in thread payload', async () => {
      const thread = createMockThreadEntity({
        metadata: { key: 'value', count: 42 },
      });
      const notification = createMockNotification({ data: thread });

      const result = await handler.handle(notification);

      const firstResult = result[0]!;
      expect(firstResult.data.metadata).toEqual({ key: 'value', count: 42 });
      expectThreadPayload(result, thread);
    });

    it('uses correct thread ID from notification', async () => {
      const customThreadId = 'custom-external-thread-id';
      const thread = createMockThreadEntity({
        externalThreadId: customThreadId,
      });
      const notification = createMockNotification({
        threadId: customThreadId,
        data: thread,
      });

      const result = await handler.handle(notification);

      const firstResult = result[0]!;
      expect(firstResult.threadId).toBe(customThreadId);
      expect(firstResult.data.externalThreadId).toBe(customThreadId);
    });

    it('sets correct notification scope to Graph', async () => {
      const thread = createMockThreadEntity();
      const notification = createMockNotification({ data: thread });

      const result = await handler.handle(notification);

      const firstResult = result[0]!;
      expect(firstResult.scope).toEqual([NotificationScope.Graph]);
    });
  });

  describe('pattern', () => {
    it('should have correct notification pattern', () => {
      expect(handler.pattern).toBe(NotificationEvent.ThreadCreate);
    });
  });
});
