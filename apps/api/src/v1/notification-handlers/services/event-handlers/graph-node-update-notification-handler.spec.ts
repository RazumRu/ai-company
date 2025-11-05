import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { GraphNodeStatus, GraphStatus } from '../../../graphs/graphs.types';
import {
  IGraphNodeUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { EnrichedNotificationEvent } from '../../notification-handlers.types';
import {
  GraphNodeUpdateNotificationHandler,
  IGraphNodeUpdateEnrichedNotification,
} from './graph-node-update-notification-handler';

describe('GraphNodeUpdateNotificationHandler', () => {
  let handler: GraphNodeUpdateNotificationHandler;
  let graphDao: GraphDao;

  const mockGraphId = 'graph-123';
  const mockOwnerId = 'user-456';

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        GraphNodeUpdateNotificationHandler,
        {
          provide: GraphDao,
          useValue: {
            getOne: vi.fn(),
          },
        },
      ],
    }).compile();

    handler = moduleRef.get(GraphNodeUpdateNotificationHandler);
    graphDao = moduleRef.get(GraphDao);
  });

  it('should enrich notification with ownerId', async () => {
    vi.mocked(graphDao.getOne).mockResolvedValue({
      id: mockGraphId,
      createdBy: mockOwnerId,
      status: GraphStatus.Running,
    } as never);

    const notification: IGraphNodeUpdateNotification = {
      type: NotificationEvent.GraphNodeUpdate,
      graphId: mockGraphId,
      nodeId: 'node-1',
      threadId: 'thread-1',
      data: { status: GraphNodeStatus.Running },
    };

    const result = await handler.handle(notification);

    const expected: IGraphNodeUpdateEnrichedNotification = {
      type: EnrichedNotificationEvent.GraphNodeUpdate,
      graphId: mockGraphId,
      ownerId: mockOwnerId,
      nodeId: 'node-1',
      threadId: 'thread-1',
      runId: undefined,
      data: {
        status: GraphNodeStatus.Running,
        error: undefined,
        metadata: undefined,
      },
    };

    expect(result).toEqual([expected]);
    expect(graphDao.getOne).toHaveBeenCalledWith({ id: mockGraphId });
  });

  it('should throw NotFoundException when graph is not found', async () => {
    vi.mocked(graphDao.getOne).mockResolvedValue(null);

    const notification: IGraphNodeUpdateNotification = {
      type: NotificationEvent.GraphNodeUpdate,
      graphId: mockGraphId,
      nodeId: 'node-1',
      data: { status: GraphNodeStatus.Idle },
    };

    await expect(handler.handle(notification)).rejects.toThrow(
      NotFoundException,
    );
  });
});
