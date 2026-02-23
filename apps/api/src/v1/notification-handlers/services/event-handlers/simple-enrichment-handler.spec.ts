import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphNodeStatus, GraphStatus } from '../../../graphs/graphs.types';
import {
  IAgentStateUpdateNotification,
  IGraphNodeUpdateNotification,
  IGraphNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { NotificationScope } from '../../notification-handlers.types';
import { SimpleEnrichmentHandler } from './simple-enrichment-handler';

describe('SimpleEnrichmentHandler', () => {
  let handler: SimpleEnrichmentHandler;
  let graphDao: GraphDao;

  const mockGraphId = 'graph-123';
  const mockOwnerId = 'user-456';

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SimpleEnrichmentHandler,
        {
          provide: GraphDao,
          useValue: {
            getOne: vi.fn().mockResolvedValue({
              id: mockGraphId,
              createdBy: mockOwnerId,
              status: GraphStatus.Running,
            }),
          },
        },
      ],
    }).compile();

    handler = moduleRef.get(SimpleEnrichmentHandler);
    graphDao = moduleRef.get(GraphDao);
  });

  describe('pattern', () => {
    it('should handle Graph, GraphNodeUpdate, and AgentStateUpdate events', () => {
      expect(handler.pattern).toEqual([
        NotificationEvent.Graph,
        NotificationEvent.GraphNodeUpdate,
        NotificationEvent.AgentStateUpdate,
      ]);
    });
  });

  describe('Graph notification', () => {
    it('should enrich graph notification with ownerId and scope', async () => {
      const notification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { status: GraphStatus.Running },
      };

      const result = await handler.handle(notification);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        nodeId: undefined,
        threadId: undefined,
        runId: undefined,
        scope: [NotificationScope.Graph],
        data: { status: GraphStatus.Running },
      });
    });
  });

  describe('GraphNodeUpdate notification', () => {
    it('should enrich with ownerId and pass through nodeId and threadId', async () => {
      const notification: IGraphNodeUpdateNotification = {
        type: NotificationEvent.GraphNodeUpdate,
        graphId: mockGraphId,
        nodeId: 'node-1',
        threadId: 'thread-1',
        data: { status: GraphNodeStatus.Running },
      };

      const result = await handler.handle(notification);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: NotificationEvent.GraphNodeUpdate,
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        nodeId: 'node-1',
        threadId: 'thread-1',
        runId: undefined,
        scope: [NotificationScope.Graph],
        data: { status: GraphNodeStatus.Running },
      });
    });
  });

  describe('AgentStateUpdate notification', () => {
    it('should use parentThreadId when available', async () => {
      const notification: IAgentStateUpdateNotification = {
        type: NotificationEvent.AgentStateUpdate,
        graphId: mockGraphId,
        nodeId: 'node-789',
        threadId: 'thread-abc',
        parentThreadId: 'parent-thread-def',
        data: { summary: 'Test summary' },
      };

      const result = await handler.handle(notification);

      expect(result).toHaveLength(1);
      expect(result[0]?.threadId).toBe('parent-thread-def');
    });

    it('should fall back to threadId when parentThreadId is missing', async () => {
      const notification: IAgentStateUpdateNotification = {
        type: NotificationEvent.AgentStateUpdate,
        graphId: mockGraphId,
        nodeId: 'node-789',
        threadId: 'thread-abc',
        parentThreadId: undefined as unknown as string,
        data: { summary: 'Thread summary' },
      };

      const result = await handler.handle(notification);

      expect(result).toHaveLength(1);
      expect(result[0]?.threadId).toBe('thread-abc');
    });

    it('should enrich with ownerId and AgentStateUpdate type', async () => {
      const notification: IAgentStateUpdateNotification = {
        type: NotificationEvent.AgentStateUpdate,
        graphId: mockGraphId,
        nodeId: 'node-789',
        threadId: 'thread-abc',
        parentThreadId: 'parent-thread-def',
        data: { done: true },
      };

      const result = await handler.handle(notification);

      expect(result).toEqual([
        {
          type: NotificationEvent.AgentStateUpdate,
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: 'node-789',
          threadId: 'parent-thread-def',
          runId: undefined,
          scope: [NotificationScope.Graph],
          data: { done: true },
        },
      ]);
    });
  });

  describe('error handling', () => {
    it('should throw NotFoundException when graph is not found', async () => {
      vi.mocked(graphDao.getOne).mockResolvedValue(null);

      const notification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { status: GraphStatus.Running },
      };

      await expect(handler.handle(notification)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
