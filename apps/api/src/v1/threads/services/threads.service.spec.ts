import { Test, TestingModule } from '@nestjs/testing';
import { AuthContextService } from '@packages/http-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { MessagesDao } from '../dao/messages.dao';
import { ThreadsDao } from '../dao/threads.dao';
import { GetMessagesQueryDto, GetThreadsQueryDto } from '../dto/threads.dto';
import { MessageEntity } from '../entity/message.entity';
import { ThreadEntity } from '../entity/thread.entity';
import { ThreadStatus } from '../threads.types';
import { ThreadsService } from './threads.service';

describe('ThreadsService', () => {
  let service: ThreadsService;
  let threadsDao: ThreadsDao;
  let messagesDao: MessagesDao;
  let authContext: AuthContextService;
  let notificationsService: NotificationsService;

  const mockUserId = 'user-123';
  const mockGraphId = 'graph-456';
  const mockThreadId = 'thread-789';

  const createMockThreadEntity = (
    overrides: Partial<ThreadEntity> = {},
  ): ThreadEntity => ({
    id: mockThreadId,
    graphId: mockGraphId,
    createdBy: mockUserId,
    externalThreadId: 'external-thread-123',
    metadata: { nodeId: 'node-1' },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    status: ThreadStatus.Running,
    ...overrides,
  });

  const createMockMessageEntity = (
    overrides: Partial<MessageEntity> = {},
  ): MessageEntity => ({
    id: 'message-123',
    threadId: mockThreadId,
    externalThreadId: 'external-thread-123',
    nodeId: 'node-1',
    message: {
      role: 'human',
      content: 'Test message',
    },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadsService,
        {
          provide: ThreadsDao,
          useValue: {
            getAll: vi.fn(),
            getOne: vi.fn(),
            create: vi.fn(),
            updateById: vi.fn(),
            deleteById: vi.fn(),
          },
        },
        {
          provide: MessagesDao,
          useValue: {
            getAll: vi.fn(),
            getOne: vi.fn(),
            create: vi.fn(),
            delete: vi.fn(),
          },
        },
        {
          provide: AuthContextService,
          useValue: {
            checkSub: vi.fn().mockReturnValue(mockUserId),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            emit: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ThreadsService>(ThreadsService);
    threadsDao = module.get<ThreadsDao>(ThreadsDao);
    messagesDao = module.get<MessagesDao>(MessagesDao);
    authContext = module.get<AuthContextService>(AuthContextService);
    notificationsService =
      module.get<NotificationsService>(NotificationsService);
  });

  describe('getThreads', () => {
    it('should return threads for the authenticated user', async () => {
      const mockThreads = [
        createMockThreadEntity(),
        createMockThreadEntity({ id: 'thread-2' }),
      ];

      vi.spyOn(threadsDao, 'getAll').mockResolvedValue(mockThreads);

      const query: GetThreadsQueryDto = {
        graphId: mockGraphId,
        limit: 50,
        offset: 0,
      };

      const result = await service.getThreads(query);

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getAll).toHaveBeenCalledWith({
        createdBy: mockUserId,
        graphId: mockGraphId,
        limit: 50,
        offset: 0,
        order: { updatedAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: mockThreadId,
        graphId: mockGraphId,
        externalThreadId: 'external-thread-123',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        status: ThreadStatus.Running,
      });
    });

    it('should return threads across all graphs when graphId is omitted', async () => {
      const mockThreads = [
        createMockThreadEntity(),
        createMockThreadEntity({ id: 'thread-2', graphId: 'graph-789' }),
      ];

      vi.spyOn(threadsDao, 'getAll').mockResolvedValue(mockThreads);

      const query: GetThreadsQueryDto = {
        limit: 25,
        offset: 5,
      };

      const result = await service.getThreads(query);

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getAll).toHaveBeenCalledWith({
        createdBy: mockUserId,
        limit: 25,
        offset: 5,
        order: { updatedAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('getThreadById', () => {
    it('should return a specific thread by ID', async () => {
      const mockThread = createMockThreadEntity();

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);

      const result = await service.getThreadById(mockThreadId);

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        id: mockThreadId,
        createdBy: mockUserId,
      });
      expect(result).toMatchObject({
        id: mockThreadId,
        graphId: mockGraphId,
        externalThreadId: 'external-thread-123',
        status: ThreadStatus.Running,
      });
    });

    it('should throw error if thread not found', async () => {
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      await expect(service.getThreadById(mockThreadId)).rejects.toThrow(
        '[THREAD_NOT_FOUND] An exception has occurred',
      );
    });

    it('should throw error if thread belongs to different user', async () => {
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      await expect(service.getThreadById(mockThreadId)).rejects.toThrow(
        '[THREAD_NOT_FOUND] An exception has occurred',
      );
    });
  });

  describe('getThreadByExternalId', () => {
    it('should return a thread by external ID', async () => {
      const mockThread = createMockThreadEntity();
      const externalThreadId = 'external-thread-123';

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);

      const result = await service.getThreadByExternalId(externalThreadId);

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        externalThreadId,
        createdBy: mockUserId,
      });
      expect(result).toMatchObject({
        id: mockThreadId,
        graphId: mockGraphId,
        externalThreadId: 'external-thread-123',
        status: ThreadStatus.Running,
      });
    });

    it('should throw error if thread not found by external ID', async () => {
      const externalThreadId = 'non-existent-external-id';

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      await expect(
        service.getThreadByExternalId(externalThreadId),
      ).rejects.toThrow('[THREAD_NOT_FOUND] An exception has occurred');
    });

    it('should throw error if thread belongs to different user', async () => {
      const externalThreadId = 'external-thread-123';

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      await expect(
        service.getThreadByExternalId(externalThreadId),
      ).rejects.toThrow('[THREAD_NOT_FOUND] An exception has occurred');
    });

    it('should handle null metadata correctly', async () => {
      const mockThread = createMockThreadEntity({ metadata: undefined });
      const externalThreadId = 'external-thread-123';

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);

      const result = await service.getThreadByExternalId(externalThreadId);

      expect(result.metadata).toEqual({});
    });
  });

  describe('getThreadMessages', () => {
    it('should return messages for a specific thread', async () => {
      const mockThread = createMockThreadEntity();
      const mockMessages = [
        createMockMessageEntity(),
        createMockMessageEntity({
          id: 'message-2',
          message: { role: 'ai', content: 'Response' },
        }),
      ];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);

      const query: GetMessagesQueryDto = {
        limit: 100,
        offset: 0,
      };

      const result = await service.getThreadMessages(mockThreadId, query);

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        id: mockThreadId,
        createdBy: mockUserId,
      });
      expect(messagesDao.getAll).toHaveBeenCalledWith({
        threadId: mockThreadId,
        limit: 100,
        offset: 0,
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'message-123',
        threadId: mockThreadId,
        message: { role: 'human', content: 'Test message' },
      });
    });

    it('should filter messages by nodeId if provided', async () => {
      const mockThread = createMockThreadEntity();
      const mockMessages = [createMockMessageEntity()];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);

      const query: GetMessagesQueryDto = {
        nodeId: 'node-1',
        limit: 100,
        offset: 0,
      };

      await service.getThreadMessages(mockThreadId, query);

      expect(messagesDao.getAll).toHaveBeenCalledWith({
        threadId: mockThreadId,
        nodeId: 'node-1',
        limit: 100,
        offset: 0,
        order: { createdAt: 'DESC' },
      });
    });

    it('should throw error if thread not found', async () => {
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      const query: GetMessagesQueryDto = {
        limit: 100,
        offset: 0,
      };

      await expect(
        service.getThreadMessages(mockThreadId, query),
      ).rejects.toThrow('[THREAD_NOT_FOUND] An exception has occurred');
    });
  });

  describe('deleteThread', () => {
    it('should delete a thread and its messages', async () => {
      const mockThread = createMockThreadEntity();

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'delete').mockResolvedValue(undefined);
      vi.spyOn(threadsDao, 'deleteById').mockResolvedValue(undefined);

      await service.deleteThread(mockThreadId);

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        id: mockThreadId,
        createdBy: mockUserId,
      });
      expect(messagesDao.delete).toHaveBeenCalledWith({
        threadId: mockThreadId,
      });
      expect(notificationsService.emit).toHaveBeenCalledWith({
        type: NotificationEvent.ThreadDelete,
        graphId: mockGraphId,
        threadId: mockThread.externalThreadId,
        internalThreadId: mockThread.id,
        data: mockThread,
      });
      expect(threadsDao.deleteById).toHaveBeenCalledWith(mockThreadId);
    });

    it('should throw error if thread not found', async () => {
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      await expect(service.deleteThread(mockThreadId)).rejects.toThrow(
        '[THREAD_NOT_FOUND] An exception has occurred',
      );

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        id: mockThreadId,
        createdBy: mockUserId,
      });
      expect(messagesDao.delete).not.toHaveBeenCalled();
      expect(notificationsService.emit).not.toHaveBeenCalled();
      expect(threadsDao.deleteById).not.toHaveBeenCalled();
    });

    it('should throw error if thread belongs to different user', async () => {
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      await expect(service.deleteThread(mockThreadId)).rejects.toThrow(
        '[THREAD_NOT_FOUND] An exception has occurred',
      );

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        id: mockThreadId,
        createdBy: mockUserId,
      });
      expect(messagesDao.delete).not.toHaveBeenCalled();
      expect(notificationsService.emit).not.toHaveBeenCalled();
      expect(threadsDao.deleteById).not.toHaveBeenCalled();
    });
  });
});
