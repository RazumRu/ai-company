import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphCheckpointsDao } from '../../agents/dao/graph-checkpoints.dao';
import { PgCheckpointSaver } from '../../agents/services/pg-checkpoint-saver';
import { ThreadTokenUsageCacheService } from '../../cache/services/thread-token-usage-cache.service';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import { GraphsService } from '../../graphs/services/graphs.service';
import { MessageTransformerService } from '../../graphs/services/message-transformer.service';
import { LitellmService } from '../../litellm/services/litellm.service';
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
  let graphRegistry: GraphRegistry;
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

  const mockLogger = {
    log: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadsService,
        {
          provide: GraphRegistry,
          useValue: {
            get: vi.fn().mockReturnValue(undefined),
            getNodesByType: vi.fn().mockReturnValue([]),
          },
        },
        {
          provide: DefaultLogger,
          useValue: mockLogger,
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
        {
          provide: GraphCheckpointsDao,
          useValue: {
            getOne: vi.fn().mockResolvedValue(null),
          },
        },
        {
          provide: PgCheckpointSaver,
          useValue: {
            getTuple: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MessageTransformerService,
          useValue: {
            transformMessagesToDto: vi.fn().mockReturnValue([]),
          },
        },
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
        {
          provide: GraphsService,
          useValue: {
            stopThreadExecution: vi.fn(),
          },
        },
        {
          provide: LitellmService,
          useValue: new LitellmService({
            listModels: vi.fn(),
          } as unknown as never),
        },
      ],
    }).compile();

    service = module.get<ThreadsService>(ThreadsService);
    threadsDao = module.get<ThreadsDao>(ThreadsDao);
    messagesDao = module.get<MessagesDao>(MessagesDao);
    graphRegistry = module.get<GraphRegistry>(GraphRegistry);
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

    it('should pass statuses filter to DAO when provided', async () => {
      const mockThreads = [
        createMockThreadEntity({ status: ThreadStatus.Done }),
      ];

      vi.spyOn(threadsDao, 'getAll').mockResolvedValue(mockThreads);

      const query: GetThreadsQueryDto = {
        graphId: mockGraphId,
        statuses: [ThreadStatus.Done],
        limit: 50,
        offset: 0,
      };

      await service.getThreads(query);

      expect(threadsDao.getAll).toHaveBeenCalledWith({
        createdBy: mockUserId,
        graphId: mockGraphId,
        statuses: [ThreadStatus.Done],
        limit: 50,
        offset: 0,
        order: { updatedAt: 'DESC' },
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

  describe('token usage aggregation', () => {
    it('sums token usage from running graph state across agents and returns from Redis', async () => {
      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Running,
        externalThreadId: 'external-thread-123',
      });

      const expectedTokenUsage = {
        inputTokens: 13,
        cachedInputTokens: 2,
        outputTokens: 7,
        reasoningTokens: 1,
        totalTokens: 20,
        totalPrice: 0.01,
        byNode: {
          'agent-1': {
            inputTokens: 10,
            cachedInputTokens: 2,
            outputTokens: 5,
            reasoningTokens: 1,
            totalTokens: 15,
            totalPrice: 0.01,
          },
          'agent-2': {
            inputTokens: 3,
            outputTokens: 2,
            totalTokens: 5,
          },
        },
      };

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(graphRegistry, 'get').mockReturnValue({} as unknown as never);
      vi.spyOn(graphRegistry, 'getNodesByType').mockReturnValue([
        {
          id: 'agent-1',
          instance: {
            getThreadTokenUsage: () => ({
              inputTokens: 10,
              cachedInputTokens: 2,
              outputTokens: 5,
              reasoningTokens: 1,
              totalTokens: 15,
              totalPrice: 0.01,
            }),
          },
        },
        {
          id: 'agent-2',
          instance: {
            getThreadTokenUsage: () => ({
              inputTokens: 3,
              outputTokens: 2,
              totalTokens: 5,
            }),
          },
        },
      ] as unknown as ReturnType<GraphRegistry['getNodesByType']>);

      // Mock the batch operation to return the expected token usage
      const mockThreadTokenUsageCacheService = (service as any)
        .threadTokenUsageCacheService;
      mockThreadTokenUsageCacheService.getMultipleThreadTokenUsage = vi
        .fn()
        .mockResolvedValue(
          new Map([[mockThread.externalThreadId, expectedTokenUsage]]),
        );

      const result = await service.getThreadById(mockThreadId);

      // tokenUsage is no longer included in thread response
      // Use GET /threads/:threadId/usage-statistics instead
      expect(result).not.toHaveProperty('tokenUsage');
    });

    it('reads token usage from DB for stopped threads', async () => {
      const tokenUsageFromDB = {
        inputTokens: 6,
        outputTokens: 3,
        totalTokens: 9,
        totalPrice: 0.02,
        byNode: {
          'agent-1': {
            inputTokens: 4,
            outputTokens: 5,
            totalTokens: 9,
            totalPrice: 0.02,
          },
        },
      };

      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Stopped,
        externalThreadId: 'external-thread-123',
        tokenUsage: tokenUsageFromDB,
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(graphRegistry, 'get').mockReturnValue(undefined);

      const result = await service.getThreadById(mockThreadId);

      // tokenUsage is no longer included in thread response
      // Use GET /threads/:threadId/usage-statistics instead
      expect(result).not.toHaveProperty('tokenUsage');
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

  describe('getThreadUsageStatistics', () => {
    it('should calculate usage statistics from message history', async () => {
      const mockThread = createMockThreadEntity();
      const mockMessages = [
        createMockMessageEntity({
          id: 'msg-1',
          nodeId: 'node-1',
          message: {
            role: 'human',
            content: 'Hello',
            additionalKwargs: {
              __requestUsage: {
                inputTokens: 10,
                outputTokens: 20,
                totalTokens: 30,
                totalPrice: 0.001,
              },
            },
          },
        }),
        createMockMessageEntity({
          id: 'msg-2',
          nodeId: 'node-1',
          message: {
            role: 'ai',
            content: 'Hi there',
            additionalKwargs: {
              __requestUsage: {
                inputTokens: 15,
                outputTokens: 25,
                totalTokens: 40,
                totalPrice: 0.002,
              },
            },
          },
        }),
        createMockMessageEntity({
          id: 'msg-3',
          nodeId: 'node-2',
          message: {
            role: 'tool',
            name: 'search',
            content: { result: 'data' },
            toolCallId: 'tool-call-1',
            additionalKwargs: {
              __requestUsage: {
                inputTokens: 5,
                outputTokens: 10,
                totalTokens: 15,
                totalPrice: 0.0005,
              },
            },
          },
        }),
        createMockMessageEntity({
          id: 'msg-4',
          nodeId: 'node-2',
          message: {
            role: 'tool-shell',
            name: 'shell',
            content: { exitCode: 0, stdout: 'ok', stderr: '' },
            toolCallId: 'tool-call-2',
            additionalKwargs: {
              __requestUsage: {
                inputTokens: 3,
                outputTokens: 7,
                totalTokens: 10,
                totalPrice: 0.0003,
              },
            },
          },
        }),
      ];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);

      const result = await service.getThreadUsageStatistics(mockThreadId);

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        id: mockThreadId,
        createdBy: mockUserId,
      });
      expect(messagesDao.getAll).toHaveBeenCalledWith({
        threadId: mockThreadId,
        order: { createdAt: 'ASC' },
      });

      // Check total
      expect(result.total).toMatchObject({
        inputTokens: 33,
        outputTokens: 62,
        totalTokens: 95,
        totalPrice: 0.0038,
      });

      // Check byNode
      expect(result.byNode['node-1']).toMatchObject({
        inputTokens: 25,
        outputTokens: 45,
        totalTokens: 70,
      });
      expect(result.byNode['node-1']!.totalPrice).toBeCloseTo(0.003, 4);
      expect(result.byNode['node-2']).toMatchObject({
        inputTokens: 8,
        outputTokens: 17,
        totalTokens: 25,
      });
      expect(result.byNode['node-2']!.totalPrice).toBeCloseTo(0.0008, 4);

      // Check byTool
      expect(result.byTool).toHaveLength(2);
      expect(result.byTool[0]).toMatchObject({
        toolName: 'search',
        totalTokens: 15,
        totalPrice: 0.0005,
        callCount: 1,
      });
      expect(result.byTool[1]).toMatchObject({
        toolName: 'shell',
        totalTokens: 10,
        totalPrice: 0.0003,
        callCount: 1,
      });

      // Check toolsAggregate
      expect(result.toolsAggregate).toMatchObject({
        inputTokens: 8,
        outputTokens: 17,
        totalTokens: 25,
        messageCount: 2,
      });
      expect(result.toolsAggregate.totalPrice).toBeCloseTo(0.0008, 4);

      // Check messagesAggregate (human + ai)
      expect(result.messagesAggregate).toMatchObject({
        inputTokens: 25,
        outputTokens: 45,
        totalTokens: 70,
        totalPrice: 0.003,
        messageCount: 2,
      });
    });

    it('should handle messages with no token usage', async () => {
      const mockThread = createMockThreadEntity();
      const mockMessages = [
        createMockMessageEntity({
          id: 'msg-1',
          nodeId: 'node-1',
          message: {
            role: 'human',
            content: 'Hello',
          },
        }),
      ];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);

      const result = await service.getThreadUsageStatistics(mockThreadId);

      expect(result.total).toMatchObject({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      });
      expect(result.byNode).toEqual({});
      expect(result.byTool).toEqual([]);
      expect(result.toolsAggregate.messageCount).toBe(0);
      expect(result.messagesAggregate.messageCount).toBe(0);
    });

    it('should aggregate multiple calls to same tool', async () => {
      const mockThread = createMockThreadEntity();
      const mockMessages = [
        createMockMessageEntity({
          id: 'msg-1',
          nodeId: 'node-1',
          message: {
            role: 'tool',
            name: 'search',
            content: { result: 'data1' },
            toolCallId: 'tool-call-1',
            additionalKwargs: {
              __requestUsage: {
                inputTokens: 5,
                outputTokens: 10,
                totalTokens: 15,
                totalPrice: 0.001,
              },
            },
          },
        }),
        createMockMessageEntity({
          id: 'msg-2',
          nodeId: 'node-1',
          message: {
            role: 'tool',
            name: 'search',
            content: { result: 'data2' },
            toolCallId: 'tool-call-2',
            additionalKwargs: {
              __requestUsage: {
                inputTokens: 7,
                outputTokens: 14,
                totalTokens: 21,
                totalPrice: 0.002,
              },
            },
          },
        }),
      ];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);

      const result = await service.getThreadUsageStatistics(mockThreadId);

      expect(result.byTool).toHaveLength(1);
      expect(result.byTool[0]).toMatchObject({
        toolName: 'search',
        totalTokens: 36,
        totalPrice: 0.003,
        callCount: 2,
      });
    });

    it('should throw error if thread not found', async () => {
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      await expect(
        service.getThreadUsageStatistics(mockThreadId),
      ).rejects.toThrow('[THREAD_NOT_FOUND] An exception has occurred');

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        id: mockThreadId,
        createdBy: mockUserId,
      });
      expect(messagesDao.getAll).not.toHaveBeenCalled();
    });

    it('should handle optional token usage fields correctly', async () => {
      const mockThread = createMockThreadEntity();
      const mockMessages = [
        createMockMessageEntity({
          id: 'msg-1',
          nodeId: 'node-1',
          message: {
            role: 'ai',
            content: 'Test',
            additionalKwargs: {
              __requestUsage: {
                inputTokens: 10,
                outputTokens: 20,
                totalTokens: 30,
                cachedInputTokens: 5,
                reasoningTokens: 3,
                totalPrice: 0.002,
                currentContext: 100,
              },
            },
          },
        }),
      ];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);

      const result = await service.getThreadUsageStatistics(mockThreadId);

      expect(result.total).toMatchObject({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cachedInputTokens: 5,
        reasoningTokens: 3,
        totalPrice: 0.002,
        currentContext: 100,
      });
    });
  });
});
