import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphEntity } from '../../../graphs/entity/graph.entity';
import { GraphStatus } from '../../../graphs/graphs.types';
import {
  IAgentStateUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import { ThreadStatus } from '../../../threads/threads.types';
import { EnrichedNotificationEvent } from '../../notification-handlers.types';
import { AgentStateUpdateNotificationHandler } from './agent-state-update-notification-handler';

describe('AgentStateUpdateNotificationHandler', () => {
  let handler: AgentStateUpdateNotificationHandler;
  let threadsDao: ThreadsDao;
  let notificationsService: NotificationsService;

  const mockGraphId = 'graph-456';
  const mockNodeId = 'node-789';
  const mockThreadId = 'thread-abc';
  const mockParentThreadId = 'parent-thread-def';
  const mockOwnerId = 'user-123';

  const createMockThreadEntity = (
    overrides: Partial<ThreadEntity> = {},
  ): ThreadEntity => ({
    id: 'thread-internal-123',
    graphId: mockGraphId,
    createdBy: mockOwnerId,
    externalThreadId: mockThreadId,
    metadata: {},
    source: undefined,
    name: undefined,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    status: ThreadStatus.Running,
    ...overrides,
  });

  const createMockNotification = (
    overrides: Partial<IAgentStateUpdateNotification> = {},
  ): IAgentStateUpdateNotification => ({
    type: NotificationEvent.AgentStateUpdate,
    graphId: mockGraphId,
    nodeId: mockNodeId,
    threadId: mockThreadId,
    parentThreadId: mockParentThreadId,
    data: {
      generatedTitle: 'Test Title',
    },
    ...overrides,
  });

  beforeEach(async () => {
    const mockGraph: GraphEntity = {
      id: mockGraphId,
      createdBy: mockOwnerId,
      name: 'Test Graph',
      description: 'Test Description',
      version: '1.0.0',
      schema: { nodes: [], edges: [] },
      status: GraphStatus.Created,
      error: undefined,
      temporary: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentStateUpdateNotificationHandler,
        {
          provide: ThreadsDao,
          useValue: {
            getOne: vi.fn(),
          },
        },
        {
          provide: GraphDao,
          useValue: {
            getOne: vi.fn().mockResolvedValue(mockGraph),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            emit: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    handler = module.get<AgentStateUpdateNotificationHandler>(
      AgentStateUpdateNotificationHandler,
    );
    threadsDao = module.get<ThreadsDao>(ThreadsDao);
    notificationsService =
      module.get<NotificationsService>(NotificationsService);
  });

  describe('handle', () => {
    it('emits thread update when generatedTitle populates name', async () => {
      const mockThread = createMockThreadEntity({ name: undefined });
      const notification = createMockNotification({
        data: { generatedTitle: 'New Name' },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      const emitSpy = vi.spyOn(notificationsService, 'emit');

      const result = await handler.handle(notification);

      expect(result).toEqual([
        {
          type: EnrichedNotificationEvent.AgentStateUpdate,
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: { generatedTitle: 'New Name' },
        },
      ]);

      expect(emitSpy).toHaveBeenCalledWith({
        type: NotificationEvent.ThreadUpdate,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockParentThreadId,
        parentThreadId: mockParentThreadId,
        data: { name: 'New Name' },
      });
    });

    it('falls back to threadId when parentThreadId is missing', async () => {
      const mockThread = createMockThreadEntity({
        externalThreadId: mockThreadId,
        name: undefined,
      });
      const notification = createMockNotification({
        parentThreadId: undefined,
        data: { generatedTitle: 'Thread Name' },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      const emitSpy = vi.spyOn(notificationsService, 'emit');

      await handler.handle(notification);

      expect(emitSpy).toHaveBeenCalledWith({
        type: NotificationEvent.ThreadUpdate,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        parentThreadId: undefined,
        data: { name: 'Thread Name' },
      });
    });

    it('emits status update when needsMoreInfo becomes true', async () => {
      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Running,
      });
      const notification = createMockNotification({
        data: {
          needsMoreInfo: true,
        },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      const emitSpy = vi.spyOn(notificationsService, 'emit');

      await handler.handle(notification);

      expect(emitSpy).toHaveBeenCalledWith({
        type: NotificationEvent.ThreadUpdate,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockParentThreadId,
        parentThreadId: mockParentThreadId,
        data: { status: ThreadStatus.NeedMoreInfo },
      });
    });

    it('emits status update when run is marked done', async () => {
      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Running,
      });
      const notification = createMockNotification({
        data: {
          done: true,
        },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      const emitSpy = vi.spyOn(notificationsService, 'emit');

      await handler.handle(notification);

      expect(emitSpy).toHaveBeenCalledWith({
        type: NotificationEvent.ThreadUpdate,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockParentThreadId,
        parentThreadId: mockParentThreadId,
        data: { status: ThreadStatus.Done },
      });
    });

    it('returns only agent state update when no thread mutation occurs', async () => {
      const notification = createMockNotification({
        data: { summary: 'Some summary' },
      });

      const result = await handler.handle(notification);

      expect(threadsDao.getOne).not.toHaveBeenCalled();
      expect(notificationsService.emit).not.toHaveBeenCalled();
      expect(result).toEqual([
        {
          type: EnrichedNotificationEvent.AgentStateUpdate,
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: { summary: 'Some summary' },
        },
      ]);
    });

    it('returns only agent state update when thread is missing', async () => {
      const notification = createMockNotification({
        data: { generatedTitle: 'Missing Thread' },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      const result = await handler.handle(notification);

      expect(notificationsService.emit).not.toHaveBeenCalled();
      expect(result).toEqual([
        {
          type: EnrichedNotificationEvent.AgentStateUpdate,
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: { generatedTitle: 'Missing Thread' },
        },
      ]);
    });
  });
});
