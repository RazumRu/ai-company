import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphEntity } from '../../../graphs/entity/graph.entity';
import { GraphStatus } from '../../../graphs/graphs.types';
import {
  IAgentStateUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { NotificationScope } from '../../notification-handlers.types';
import { AgentStateUpdateNotificationHandler } from './agent-state-update-notification-handler';

describe('AgentStateUpdateNotificationHandler', () => {
  let handler: AgentStateUpdateNotificationHandler;

  const mockGraphId = 'graph-456';
  const mockNodeId = 'node-789';
  const mockThreadId = 'thread-abc';
  const mockParentThreadId = 'parent-thread-def';
  const mockOwnerId = 'user-123';

  const createMockNotification = (
    overrides: Partial<IAgentStateUpdateNotification> = {},
  ): IAgentStateUpdateNotification => ({
    type: NotificationEvent.AgentStateUpdate,
    graphId: mockGraphId,
    nodeId: mockNodeId,
    threadId: mockThreadId,
    parentThreadId: mockParentThreadId,
    data: {
      summary: 'Test summary',
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
      targetVersion: '1.0.0',
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
          provide: GraphDao,
          useValue: {
            getOne: vi.fn().mockResolvedValue(mockGraph),
          },
        },
      ],
    }).compile();

    handler = module.get<AgentStateUpdateNotificationHandler>(
      AgentStateUpdateNotificationHandler,
    );
  });

  describe('handle', () => {
    it('enriches agent state update with summary', async () => {
      const notification = createMockNotification({
        data: { summary: 'New summary' },
      });

      const result = await handler.handle(notification);

      // Handler now only enriches AgentStateUpdate, ThreadUpdate is handled in graph-state.manager
      expect(result).toEqual([
        {
          type: NotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockParentThreadId,
          data: { summary: 'New summary' },
        },
      ]);
    });

    it('enriches agent state update with threadId when parentThreadId is missing', async () => {
      const notification = createMockNotification({
        parentThreadId: undefined,
        data: { summary: 'Thread summary' },
      });

      const result = await handler.handle(notification);

      // Handler now only enriches AgentStateUpdate
      expect(result).toEqual([
        {
          type: NotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: { summary: 'Thread summary' },
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
          type: NotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockParentThreadId,
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
          type: NotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockParentThreadId,
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
          type: NotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockParentThreadId,
          data: { summary: 'Some summary' },
        },
      ]);
    });

    it('enriches agent state update regardless of data content', async () => {
      const notification = createMockNotification({
        data: { summary: 'Any summary' },
      });

      const result = await handler.handle(notification);

      expect(result).toEqual([
        {
          type: NotificationEvent.AgentStateUpdate,
          scope: [NotificationScope.Graph],
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockParentThreadId,
          data: { summary: 'Any summary' },
        },
      ]);
    });
  });
});
