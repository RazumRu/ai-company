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
import {
  EnrichedNotificationEvent,
  NotificationScope,
} from '../../notification-handlers.types';
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
    it('enriches agent state update with generatedTitle', async () => {
      const notification = createMockNotification({
        data: { generatedTitle: 'New Name' },
      });

      const result = await handler.handle(notification);

      // Handler now only enriches AgentStateUpdate, ThreadUpdate is handled in graph-state.manager
      expect(result).toEqual([
        {
          type: EnrichedNotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: { generatedTitle: 'New Name' },
        },
      ]);
    });

    it('enriches agent state update with threadId when parentThreadId is missing', async () => {
      const notification = createMockNotification({
        parentThreadId: undefined,
        data: { generatedTitle: 'Thread Name' },
      });

      const result = await handler.handle(notification);

      // Handler now only enriches AgentStateUpdate
      expect(result).toEqual([
        {
          type: EnrichedNotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: { generatedTitle: 'Thread Name' },
        },
      ]);
    });

    it('enriches agent state update when needsMoreInfo is set', async () => {
      const notification = createMockNotification({
        data: {
          needsMoreInfo: true,
        },
      });

      const result = await handler.handle(notification);

      // Handler now only enriches AgentStateUpdate, status updates are handled in graph-state.manager
      expect(result).toEqual([
        {
          type: EnrichedNotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: { needsMoreInfo: true },
        },
      ]);
    });

    it('enriches agent state update when run is marked done', async () => {
      const notification = createMockNotification({
        data: {
          done: true,
        },
      });

      const result = await handler.handle(notification);

      // Handler now only enriches AgentStateUpdate, status updates are handled in graph-state.manager
      expect(result).toEqual([
        {
          type: EnrichedNotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: { done: true },
        },
      ]);
    });

    it('returns only agent state update when no special state change occurs', async () => {
      const notification = createMockNotification({
        data: { summary: 'Some summary' },
      });

      const result = await handler.handle(notification);

      // No ThreadUpdate emissions in this handler anymore
      expect(result).toEqual([
        {
          type: EnrichedNotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: { summary: 'Some summary' },
        },
      ]);
    });

    it('enriches agent state update regardless of data content', async () => {
      const notification = createMockNotification({
        data: { generatedTitle: 'Any Title' },
      });

      const result = await handler.handle(notification);

      expect(result).toEqual([
        {
          type: EnrichedNotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: { generatedTitle: 'Any Title' },
        },
      ]);
    });
  });
});
