import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IAgentStateUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import { AgentStateUpdateNotificationHandler } from './agent-state-update-notification-handler';

describe('AgentStateUpdateNotificationHandler', () => {
  let handler: AgentStateUpdateNotificationHandler;
  let threadsDao: ThreadsDao;

  const mockGraphId = 'graph-456';
  const mockNodeId = 'node-789';
  const mockThreadId = 'thread-abc';
  const mockParentThreadId = 'parent-thread-def';

  const createMockThreadEntity = (
    overrides: Partial<ThreadEntity> = {},
  ): ThreadEntity => ({
    id: 'thread-internal-123',
    graphId: mockGraphId,
    createdBy: 'user-123',
    externalThreadId: mockThreadId,
    metadata: {},
    source: undefined,
    name: undefined,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
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
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentStateUpdateNotificationHandler,
        {
          provide: ThreadsDao,
          useValue: {
            getOne: vi.fn(),
            updateById: vi.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get<AgentStateUpdateNotificationHandler>(
      AgentStateUpdateNotificationHandler,
    );
    threadsDao = module.get<ThreadsDao>(ThreadsDao);
  });

  describe('handle', () => {
    it('should update thread name when generatedTitle is provided and thread has no name', async () => {
      const mockThread = createMockThreadEntity({ name: undefined });
      const notification = createMockNotification({
        data: { generatedTitle: 'New Generated Title' },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(threadsDao, 'updateById').mockResolvedValue(
        createMockThreadEntity({ name: 'New Generated Title' }),
      );

      const result = await handler.handle(notification);

      expect(threadsDao.getOne).toHaveBeenCalledWith({
        externalThreadId: mockParentThreadId,
        graphId: mockGraphId,
      });
      expect(threadsDao.updateById).toHaveBeenCalledWith(mockThread.id, {
        name: 'New Generated Title',
      });
      expect(result).toEqual([]);
    });

    it('should use threadId when parentThreadId is not provided', async () => {
      const mockThread = createMockThreadEntity({
        externalThreadId: mockThreadId,
        name: undefined,
      });
      const notification = createMockNotification({
        parentThreadId: undefined,
        data: { generatedTitle: 'New Title' },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(threadsDao, 'updateById').mockResolvedValue(
        createMockThreadEntity({ name: 'New Title' }),
      );

      await handler.handle(notification);

      expect(threadsDao.getOne).toHaveBeenCalledWith({
        externalThreadId: mockThreadId,
        graphId: mockGraphId,
      });
    });

    it('should not update thread name if generatedTitle is not provided', async () => {
      const notification = createMockNotification({
        data: { summary: 'Some summary' },
      });

      const result = await handler.handle(notification);

      expect(threadsDao.getOne).not.toHaveBeenCalled();
      expect(threadsDao.updateById).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should not update thread name if thread already has a name', async () => {
      const mockThread = createMockThreadEntity({ name: 'Existing Name' });
      const notification = createMockNotification({
        data: { generatedTitle: 'New Generated Title' },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(threadsDao, 'updateById');

      const result = await handler.handle(notification);

      expect(threadsDao.getOne).toHaveBeenCalled();
      expect(threadsDao.updateById).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should skip update if thread not found', async () => {
      const notification = createMockNotification({
        data: { generatedTitle: 'New Title' },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);
      vi.spyOn(threadsDao, 'updateById');

      const result = await handler.handle(notification);

      expect(threadsDao.getOne).toHaveBeenCalled();
      expect(threadsDao.updateById).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should handle empty generatedTitle string', async () => {
      const notification = createMockNotification({
        data: { generatedTitle: '' },
      });

      const result = await handler.handle(notification);

      expect(threadsDao.getOne).not.toHaveBeenCalled();
      expect(threadsDao.updateById).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('pattern', () => {
    it('should have correct notification pattern', () => {
      expect(handler.pattern).toBe(NotificationEvent.AgentStateUpdate);
    });
  });

  describe('socket integration', () => {
    it('should handle notification that will be broadcast via socket', async () => {
      const mockThread = createMockThreadEntity({ name: undefined });
      const notification = createMockNotification({
        data: {
          generatedTitle: 'Socket Test Title',
          summary: 'Updated summary',
          done: false,
        },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(threadsDao, 'updateById').mockResolvedValue(
        createMockThreadEntity({ name: 'Socket Test Title' }),
      );

      const result = await handler.handle(notification);

      expect(threadsDao.getOne).toHaveBeenCalledWith({
        externalThreadId: mockParentThreadId,
        graphId: mockGraphId,
      });
      expect(threadsDao.updateById).toHaveBeenCalledWith(mockThread.id, {
        name: 'Socket Test Title',
      });
      expect(result).toEqual([]);
    });

    it('should handle notification with multiple state changes', async () => {
      const mockThread = createMockThreadEntity({ name: undefined });
      const notification = createMockNotification({
        data: {
          generatedTitle: 'Multi State Title',
          summary: 'Final summary',
          done: true,
          toolUsageGuardActivated: true,
          toolUsageGuardActivatedCount: 3,
        },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(threadsDao, 'updateById').mockResolvedValue(
        createMockThreadEntity({ name: 'Multi State Title' }),
      );

      const result = await handler.handle(notification);

      expect(threadsDao.getOne).toHaveBeenCalledWith({
        externalThreadId: mockParentThreadId,
        graphId: mockGraphId,
      });
      expect(threadsDao.updateById).toHaveBeenCalledWith(mockThread.id, {
        name: 'Multi State Title',
      });
      expect(result).toEqual([]);
    });
  });
});
