import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphCheckpointsDao } from '../../agents/dao/graph-checkpoints.dao';
import { CheckpointStateService } from '../../agents/services/checkpoint-state.service';
import { PgCheckpointSaver } from '../../agents/services/pg-checkpoint-saver';
import { MessageRole } from '../../graphs/graphs.types';
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
  let mockGraphRegistry: GraphRegistry;

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
      role: MessageRole.Human,
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
          provide: CheckpointStateService,
          useValue: {
            getThreadTokenUsage: vi.fn().mockResolvedValue(null),
            getRootThreadTokenUsage: vi.fn().mockResolvedValue(null),
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
          useValue: {
            extractMessageTokenUsageFromAdditionalKwargs: vi
              .fn()
              .mockImplementation((additionalKwargs) => {
                // Mock implementation that extracts __tokenUsage from additionalKwargs
                if (
                  additionalKwargs &&
                  typeof additionalKwargs === 'object' &&
                  '__tokenUsage' in additionalKwargs
                ) {
                  return additionalKwargs.__tokenUsage as any;
                }
                return null;
              }),
          },
        },
      ],
    }).compile();

    service = module.get<ThreadsService>(ThreadsService);
    threadsDao = module.get<ThreadsDao>(ThreadsDao);
    messagesDao = module.get<MessagesDao>(MessagesDao);
    graphRegistry = module.get<GraphRegistry>(GraphRegistry);
    mockGraphRegistry = module.get<GraphRegistry>(GraphRegistry);
    authContext = module.get<AuthContextService>(AuthContextService);
    notificationsService =
      module.get<NotificationsService>(NotificationsService);

    // Ensure litellmService is accessible
    (service as any).litellmService =
      module.get<LitellmService>(LitellmService);
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

      // Token usage is no longer batched from Redis
      // It's fetched separately via getThreadUsageStatistics()

      const result = await service.getThreadById(mockThreadId);

      // tokenUsage is no longer included in thread response
      // Use GET /threads/:threadId/usage-statistics instead
      expect(result).not.toHaveProperty('tokenUsage');
    });

    it('no longer includes token usage in thread response', async () => {
      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Stopped,
        externalThreadId: 'external-thread-123',
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
          message: { role: MessageRole.AI, content: 'Response' },
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
        message: { role: MessageRole.Human, content: 'Test message' },
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
    it('should return usage statistics from checkpoint for completed thread', async () => {
      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Done,
        externalThreadId: 'external-thread-123',
      });

      // Checkpoint data should only include requestTokenUsage (from LLM requests)
      // Tool messages don't have requestTokenUsage, so they're not in the checkpoint
      const mockTokenUsageFromCheckpoint = {
        inputTokens: 75, // 10 + 15 + 50 (human + ai calling + ai processing)
        outputTokens: 75, // 20 + 25 + 30 (human + ai calling + ai processing)
        totalTokens: 150, // 30 + 40 + 80 (human + ai calling + ai processing)
        totalPrice: 0.007, // 0.001 + 0.002 + 0.004 (human + ai calling + ai processing)
        byNode: {
          'node-1': {
            inputTokens: 25, // 10 + 15 (human + ai calling in node-1)
            outputTokens: 45, // 20 + 25 (human + ai calling in node-1)
            totalTokens: 70, // 30 + 40 (human + ai calling in node-1)
            totalPrice: 0.003, // 0.001 + 0.002 (human + ai calling in node-1)
          },
          'node-2': {
            inputTokens: 50, // ai processing in node-2
            outputTokens: 30,
            totalTokens: 80,
            totalPrice: 0.004,
          },
        },
      };

      const mockMessages = [
        createMockMessageEntity({
          id: 'msg-1',
          nodeId: 'node-1',
          role: MessageRole.Human,
          name: undefined,
          requestTokenUsage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            totalPrice: 0.001,
          },
        }),
        createMockMessageEntity({
          id: 'msg-2',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: ['search', 'shell'],
          requestTokenUsage: {
            inputTokens: 15,
            outputTokens: 25,
            totalTokens: 40,
            totalPrice: 0.002,
          },
        }),
        createMockMessageEntity({
          id: 'msg-3',
          nodeId: 'node-2',
          role: MessageRole.Tool,
          name: 'search',
          requestTokenUsage: undefined, // Tool messages don't have requestTokenUsage
          message: {
            role: MessageRole.Tool,
            name: 'search',
            toolCallId: 'call_search_123',
            content: { result: 'search result' },
            additionalKwargs: {
              __tokenUsage: {
                totalTokens: 15,
                totalPrice: 0.0005,
              },
            },
          },
        }),
        createMockMessageEntity({
          id: 'msg-4',
          nodeId: 'node-2',
          role: MessageRole.Tool,
          name: 'shell',
          requestTokenUsage: undefined, // Tool messages don't have requestTokenUsage
          message: {
            role: MessageRole.Tool,
            name: 'shell',
            toolCallId: 'call_shell_456',
            content: { exitCode: 0, stdout: 'shell output', stderr: '' },
            additionalKwargs: {
              __tokenUsage: {
                totalTokens: 10,
                totalPrice: 0.0003,
              },
            },
          },
        }),
        // NEW: AI message processing tool results (no tool_calls)
        createMockMessageEntity({
          id: 'msg-5',
          nodeId: 'node-2',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: [], // No tool calls - this is processing tool results
          answeredToolCallNames: ['search', 'shell'],
          requestTokenUsage: {
            inputTokens: 50,
            outputTokens: 30,
            totalTokens: 80,
            totalPrice: 0.004,
          },
        }),
      ];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);

      // Mock checkpoint service to return token usage
      const mockCheckpointStateService = (service as any)
        .checkpointStateService;
      vi.spyOn(
        mockCheckpointStateService,
        'getThreadTokenUsage',
      ).mockResolvedValue(mockTokenUsageFromCheckpoint);

      // Mock graph registry to not find agent in memory (force checkpoint lookup)
      vi.spyOn(mockGraphRegistry, 'getNodesByType').mockReturnValue([]);

      const result = await service.getThreadUsageStatistics(mockThreadId);

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        id: mockThreadId,
        createdBy: mockUserId,
      });
      expect(messagesDao.getAll).toHaveBeenCalledWith({
        externalThreadId: mockThread.externalThreadId,
        order: { createdAt: 'ASC' },
        projection: [
          'id',
          'nodeId',
          'role',
          'name',
          'requestTokenUsage',
          'toolCallNames',
          'answeredToolCallNames',
        ],
      });

      // Check total (only from requestTokenUsage)
      expect(result.total).toMatchObject({
        inputTokens: 75, // 10 + 15 + 50 (human + ai calling + ai processing)
        outputTokens: 75, // 20 + 25 + 30 (human + ai calling + ai processing)
        totalTokens: 150, // 30 + 40 + 80 (human + ai calling + ai processing)
        totalPrice: 0.007, // 0.001 + 0.002 + 0.004 (human + ai calling + ai processing)
      });

      // Check byNode (only from requestTokenUsage)
      expect(result.byNode['node-1']).toMatchObject({
        inputTokens: 25, // 10 + 15 (human + ai calling)
        outputTokens: 45, // 20 + 25 (human + ai calling)
        totalTokens: 70, // 30 + 40 (human + ai calling)
      });
      expect(result.byNode['node-1']!.totalPrice).toBeCloseTo(0.003, 4);
      expect(result.byNode['node-2']).toMatchObject({
        inputTokens: 50, // ai processing
        outputTokens: 30,
        totalTokens: 80,
      });
      expect(result.byNode['node-2']!.totalPrice).toBeCloseTo(0.004, 4);

      // Check byTool (from AI message processing tool results)
      // AI processing message has 80 tokens @ 0.004, split between 2 tools = 40 tokens @ 0.002 each
      expect(result.byTool).toHaveLength(2);
      expect(result.byTool[0]).toMatchObject({
        toolName: 'search',
        totalTokens: 80,
        totalPrice: 0.004,
        callCount: 1,
      });
      expect(result.byTool[1]).toMatchObject({
        toolName: 'shell',
        totalTokens: 80,
        totalPrice: 0.004,
        callCount: 1,
      });

      // Check total requests (only messages with requestTokenUsage)
      expect(result.requests).toBe(3); // human + ai calling + ai processing

      // Check toolsAggregate (AI messages processing tool results, not calling tools)
      expect(result.toolsAggregate).toMatchObject({
        inputTokens: 50, // AI message processing tool results
        outputTokens: 30,
        totalTokens: 80,
        requestCount: 1, // 1 AI message processing tool results
      });
      expect(result.toolsAggregate.totalPrice).toBeCloseTo(0.004, 4);

      // Check messagesAggregate (human + AI messages with tool calls)
      // AI messages WITH tool calls now go to messagesAggregate (not toolsAggregate)
      expect(result.messagesAggregate).toMatchObject({
        inputTokens: 25, // 10 (human) + 15 (ai calling tools)
        outputTokens: 45, // 20 (human) + 25 (ai calling tools)
        totalTokens: 70, // 30 (human) + 40 (ai calling tools)
        requestCount: 2, // human + ai calling tools
      });
      expect(result.messagesAggregate.totalPrice).toBeCloseTo(0.003, 4);
    });

    it('should throw NotFoundException when thread has no usage statistics', async () => {
      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Done,
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);

      // Mock no checkpoint data available
      const mockCheckpointStateService = (service as any)
        .checkpointStateService;
      vi.spyOn(
        mockCheckpointStateService,
        'getThreadTokenUsage',
      ).mockResolvedValue(null);

      // Mock graph registry to not find agent in memory
      vi.spyOn(mockGraphRegistry, 'getNodesByType').mockReturnValue([]);

      await expect(
        service.getThreadUsageStatistics(mockThreadId),
      ).rejects.toThrow('THREAD_USAGE_STATISTICS_NOT_FOUND');
    });

    it('should aggregate multiple calls to same tool', async () => {
      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Done,
        externalThreadId: 'external-thread-123',
      });

      const mockTokenUsageFromCheckpoint = {
        inputTokens: 37, // 5 + 7 + 10 + 15 (two calls, two processing)
        outputTokens: 74, // 10 + 14 + 20 + 30 (two calls, two processing)
        totalTokens: 111, // 15 + 21 + 30 + 45 (two calls, two processing)
        totalPrice: 0.008, // 0.001 + 0.002 + 0.002 + 0.003 (two calls, two processing)
        byNode: {
          'node-1': {
            inputTokens: 37,
            outputTokens: 74,
            totalTokens: 111,
            totalPrice: 0.008,
          },
        },
      };

      const mockMessages = [
        // First: AI calling search
        createMockMessageEntity({
          id: 'msg-1',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: ['search'],
          requestTokenUsage: {
            inputTokens: 5,
            outputTokens: 10,
            totalTokens: 15,
            totalPrice: 0.001,
          },
        }),
        // Tool result
        createMockMessageEntity({
          id: 'msg-2',
          nodeId: 'node-1',
          role: MessageRole.Tool,
          name: 'search',
          requestTokenUsage: undefined,
        }),
        // AI processing first tool result
        createMockMessageEntity({
          id: 'msg-3',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: [], // No tool calls - processing result
          answeredToolCallNames: ['search'],
          requestTokenUsage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            totalPrice: 0.002,
          },
        }),
        // Second: AI calling search again
        createMockMessageEntity({
          id: 'msg-4',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: ['search'],
          requestTokenUsage: {
            inputTokens: 7,
            outputTokens: 14,
            totalTokens: 21,
            totalPrice: 0.002,
          },
        }),
        // Tool result
        createMockMessageEntity({
          id: 'msg-5',
          nodeId: 'node-1',
          role: MessageRole.Tool,
          name: 'search',
          requestTokenUsage: undefined,
        }),
        // AI processing second tool result
        createMockMessageEntity({
          id: 'msg-6',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: [], // No tool calls - processing result
          answeredToolCallNames: ['search'],
          requestTokenUsage: {
            inputTokens: 15,
            outputTokens: 30,
            totalTokens: 45,
            totalPrice: 0.003,
          },
        }),
      ];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);

      // Mock checkpoint service to return token usage
      const mockCheckpointStateService = (service as any)
        .checkpointStateService;
      vi.spyOn(
        mockCheckpointStateService,
        'getThreadTokenUsage',
      ).mockResolvedValue(mockTokenUsageFromCheckpoint);

      // Mock graph registry to not find agent in memory (force checkpoint lookup)
      vi.spyOn(mockGraphRegistry, 'getNodesByType').mockReturnValue([]);

      const result = await service.getThreadUsageStatistics(mockThreadId);

      // byTool should aggregate usage from the two AI messages processing tool results (msg-3 and msg-6)
      expect(result.byTool).toHaveLength(1);
      expect(result.byTool[0]).toMatchObject({
        toolName: 'search',
        totalTokens: 75, // 30 + 45 (from processing messages)
        totalPrice: 0.005, // 0.002 + 0.003 (from processing messages)
        callCount: 2, // Two tool result messages
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

    it('should handle optional token usage fields correctly from checkpoint', async () => {
      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Done,
        externalThreadId: 'external-thread-123',
      });

      const mockTokenUsage = {
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
        cachedInputTokens: 5,
        reasoningTokens: 3,
        totalPrice: 0.002,
        currentContext: 100,
        byNode: {
          'node-1': {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            cachedInputTokens: 5,
            reasoningTokens: 3,
            totalPrice: 0.002,
            currentContext: 100,
          },
        },
      };

      const mockMessages = [
        createMockMessageEntity({
          id: 'msg-1',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          requestTokenUsage: {
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            cachedInputTokens: 5,
            reasoningTokens: 3,
            totalPrice: 0.002,
            currentContext: 100,
          },
        }),
      ];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);

      // Mock checkpoint service to return token usage
      const mockCheckpointStateService = (service as any)
        .checkpointStateService;
      vi.spyOn(
        mockCheckpointStateService,
        'getThreadTokenUsage',
      ).mockResolvedValue(mockTokenUsage);

      // Mock graph registry to not find agent in memory (force checkpoint lookup)
      vi.spyOn(mockGraphRegistry, 'getNodesByType').mockReturnValue([]);

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
