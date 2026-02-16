import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CheckpointStateService } from '../../agents/services/checkpoint-state.service';
import { MessageRole } from '../../graphs/graphs.types';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import { GraphsService } from '../../graphs/services/graphs.service';
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
  let checkpointStateService: CheckpointStateService;

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
          useValue: {},
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
    checkpointStateService = module.get<CheckpointStateService>(
      CheckpointStateService,
    );
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

    it('should throw error if thread not found or belongs to different user', async () => {
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

    it('should throw error if thread not found or belongs to different user', async () => {
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      await expect(
        service.getThreadByExternalId('non-existent-external-id'),
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
    it('does not include tokenUsage in thread response for running threads', async () => {
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

    it('should throw error if thread not found or belongs to different user', async () => {
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

  describe('setMetadata', () => {
    it('should update thread metadata and return updated thread', async () => {
      const mockThread = createMockThreadEntity();
      const updatedThread = createMockThreadEntity({
        metadata: { key: 'value', count: 42 },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(threadsDao, 'updateById').mockResolvedValue(updatedThread);

      const result = await service.setMetadata(mockThreadId, {
        metadata: { key: 'value', count: 42 },
      });

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        id: mockThreadId,
        createdBy: mockUserId,
      });
      expect(threadsDao.updateById).toHaveBeenCalledWith(mockThreadId, {
        metadata: { key: 'value', count: 42 },
      });
      expect(result.metadata).toEqual({ key: 'value', count: 42 });
    });

    it('should throw error if thread not found', async () => {
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      await expect(
        service.setMetadata(mockThreadId, { metadata: { key: 'value' } }),
      ).rejects.toThrow('[THREAD_NOT_FOUND] An exception has occurred');

      expect(threadsDao.updateById).not.toHaveBeenCalled();
    });

    it('should allow setting empty metadata', async () => {
      const mockThread = createMockThreadEntity();
      const updatedThread = createMockThreadEntity({ metadata: {} });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(threadsDao, 'updateById').mockResolvedValue(updatedThread);

      const result = await service.setMetadata(mockThreadId, { metadata: {} });

      expect(threadsDao.updateById).toHaveBeenCalledWith(mockThreadId, {
        metadata: {},
      });
      expect(result.metadata).toEqual({});
    });
  });

  describe('setMetadataByExternalId', () => {
    it('should update thread metadata by external ID and return updated thread', async () => {
      const externalThreadId = 'external-thread-123';
      const mockThread = createMockThreadEntity({ externalThreadId });
      const updatedThread = createMockThreadEntity({
        externalThreadId,
        metadata: { env: 'production', version: 2 },
      });

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(threadsDao, 'updateById').mockResolvedValue(updatedThread);

      const result = await service.setMetadataByExternalId(externalThreadId, {
        metadata: { env: 'production', version: 2 },
      });

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        externalThreadId,
        createdBy: mockUserId,
      });
      expect(threadsDao.updateById).toHaveBeenCalledWith(mockThreadId, {
        metadata: { env: 'production', version: 2 },
      });
      expect(result.metadata).toEqual({ env: 'production', version: 2 });
    });

    it('should throw error if thread not found by external ID', async () => {
      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(null);

      await expect(
        service.setMetadataByExternalId('non-existent-external-id', {
          metadata: { key: 'value' },
        }),
      ).rejects.toThrow('[THREAD_NOT_FOUND] An exception has occurred');

      expect(threadsDao.updateById).not.toHaveBeenCalled();
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
          requestTokenUsage: undefined, // Human messages don't have requestTokenUsage
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
      vi.spyOn(checkpointStateService, 'getThreadTokenUsage').mockResolvedValue(
        mockTokenUsageFromCheckpoint,
      );

      // Mock graph registry to not find agent in memory (force checkpoint lookup)
      vi.spyOn(graphRegistry, 'getNodesByType').mockReturnValue([]);

      const result = await service.getThreadUsageStatistics(mockThreadId);

      expect(authContext.checkSub).toHaveBeenCalled();
      expect(threadsDao.getOne).toHaveBeenCalledWith({
        id: mockThreadId,
        createdBy: mockUserId,
      });
      expect(messagesDao.getAll).toHaveBeenCalledWith({
        threadId: mockThreadId,
        order: { createdAt: 'ASC' },
        projection: [
          'id',
          'nodeId',
          'role',
          'name',
          'requestTokenUsage',
          'toolCallNames',
          'answeredToolCallNames',
          'additionalKwargs',
          'toolCallIds',
          'toolTokenUsage',
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

      // Check byTool — callCount from toolCallNames, usage from AI messages
      // msg-2 calls search+shell (callCount 1 each, 40 tokens each)
      // msg-5 answers search+shell (no callCount, 80 tokens attributed to each)
      expect(result.byTool).toHaveLength(2);
      expect(result.byTool[0]).toMatchObject({
        toolName: 'search',
        totalTokens: 120, // 40 (calling) + 80 (answering)
        callCount: 1,
      });
      expect(result.byTool[0]!.totalPrice).toBeCloseTo(0.006, 4);
      expect(result.byTool[1]).toMatchObject({
        toolName: 'shell',
        totalTokens: 120, // 40 (calling) + 80 (answering)
        callCount: 1,
      });
      expect(result.byTool[1]!.totalPrice).toBeCloseTo(0.006, 4);

      // Check total requests (only AI messages with requestTokenUsage)
      expect(result.requests).toBe(2); // ai calling + ai processing

      // Check toolsAggregate (all tool-related LLM requests)
      // msg-2 (AI calling tools, 40 tokens) + msg-5 (AI answering tools, 80 tokens)
      expect(result.toolsAggregate).toMatchObject({
        inputTokens: 65, // 15 + 50
        outputTokens: 55, // 25 + 30
        totalTokens: 120, // 40 + 80
        requestCount: 2,
      });
      expect(result.toolsAggregate.totalPrice).toBeCloseTo(0.006, 4);

      // Check userMessageCount
      expect(result.userMessageCount).toBe(1);
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
      vi.spyOn(checkpointStateService, 'getThreadTokenUsage').mockResolvedValue(
        mockTokenUsageFromCheckpoint,
      );

      // Mock graph registry to not find agent in memory (force checkpoint lookup)
      vi.spyOn(graphRegistry, 'getNodesByType').mockReturnValue([]);

      const result = await service.getThreadUsageStatistics(mockThreadId);

      // byTool should aggregate all tool-related usage (calling + answering)
      expect(result.byTool).toHaveLength(1);
      expect(result.byTool[0]).toMatchObject({
        toolName: 'search',
        totalTokens: 111, // 15 + 30 + 21 + 45 (two calls + two answers)
        totalPrice: 0.008, // 0.001 + 0.002 + 0.002 + 0.003
        callCount: 2, // Two AI messages with toolCallNames=['search']
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

    it('should nest subagent internal tool calls under parent tool as subCalls', async () => {
      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Done,
        externalThreadId: 'external-thread-123',
      });

      const mockTokenUsageFromCheckpoint = {
        inputTokens: 100,
        outputTokens: 80,
        totalTokens: 180,
        totalPrice: 0.01,
        byNode: {
          'node-1': {
            inputTokens: 100,
            outputTokens: 80,
            totalTokens: 180,
            totalPrice: 0.01,
          },
        },
      };

      const parentToolCallId = 'call_867775e4';

      const mockMessages = [
        // 1. Parent AI message that calls subagents_run_task
        createMockMessageEntity({
          id: 'msg-parent-ai',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: ['subagents_run_task'],
          toolCallIds: [parentToolCallId],
          additionalKwargs: {},
          requestTokenUsage: {
            inputTokens: 60,
            outputTokens: 40,
            totalTokens: 100,
            totalPrice: 0.005,
          },
        }),
        // 2. Subagent internal AI message that calls files_write_file (__hideForLlm)
        createMockMessageEntity({
          id: 'msg-subagent-ai-1',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: ['files_write_file'],
          requestTokenUsage: undefined, // Stripped for __hideForLlm
          additionalKwargs: {
            __hideForLlm: true,
            __toolCallId: parentToolCallId,
            __requestUsage: {
              inputTokens: 2000,
              outputTokens: 1563,
              totalTokens: 3563,
              totalPrice: 0,
            },
          },
        }),
        // 3. Subagent internal tool result (files_write_file)
        createMockMessageEntity({
          id: 'msg-subagent-tool',
          nodeId: 'node-1',
          role: MessageRole.Tool,
          name: 'files_write_file',
          requestTokenUsage: undefined,
          additionalKwargs: {
            __hideForLlm: true,
            __toolCallId: parentToolCallId,
          },
        }),
        // 4. Subagent internal AI final response (no tool calls) (__hideForLlm)
        createMockMessageEntity({
          id: 'msg-subagent-ai-2',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: [], // No tool calls - final response
          requestTokenUsage: undefined, // Stripped for __hideForLlm
          additionalKwargs: {
            __hideForLlm: true,
            __toolCallId: parentToolCallId,
            __requestUsage: {
              inputTokens: 2000,
              outputTokens: 1518,
              totalTokens: 3518,
              totalPrice: 0,
            },
          },
        }),
        // 5. Tool result for subagents_run_task (with own toolTokenUsage)
        createMockMessageEntity({
          id: 'msg-tool-result',
          nodeId: 'node-1',
          role: MessageRole.Tool,
          name: 'subagents_run_task',
          requestTokenUsage: undefined, // Tool messages don't have requestTokenUsage
          toolTokenUsage: {
            inputTokens: 4000,
            outputTokens: 3081,
            totalTokens: 7081,
            totalPrice: 0,
          },
          additionalKwargs: {},
        }),
        // 6. AI message processing the tool result (answeredToolCallNames)
        createMockMessageEntity({
          id: 'msg-answer-ai',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: [],
          answeredToolCallNames: ['subagents_run_task'],
          requestTokenUsage: {
            inputTokens: 40,
            outputTokens: 40,
            totalTokens: 80,
            totalPrice: 0.005,
          },
        }),
      ];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);

      vi.spyOn(checkpointStateService, 'getThreadTokenUsage').mockResolvedValue(
        mockTokenUsageFromCheckpoint,
      );
      vi.spyOn(graphRegistry, 'getNodesByType').mockReturnValue([]);

      const result = await service.getThreadUsageStatistics(mockThreadId);

      // subagents_run_task should appear in byTool with subCalls
      const subagentEntry = result.byTool.find(
        (t) => t.toolName === 'subagents_run_task',
      );
      expect(subagentEntry).toBeDefined();
      expect(subagentEntry!.callCount).toBe(1);
      // totalTokens = 100 (calling) + 80 (answering) = 180
      expect(subagentEntry!.totalTokens).toBe(180);

      // toolTokens/toolPrice from tool result message
      expect(subagentEntry!.toolTokens).toBe(7081);
      expect(subagentEntry!.toolPrice).toBe(0);

      // subCalls should contain files_write_file and (llm_response)
      expect(subagentEntry!.subCalls).toBeDefined();
      expect(subagentEntry!.subCalls).toHaveLength(2);

      const writeFileSubCall = subagentEntry!.subCalls!.find(
        (sc) => sc.toolName === 'files_write_file',
      );
      expect(writeFileSubCall).toBeDefined();
      expect(writeFileSubCall!.callCount).toBe(1);
      expect(writeFileSubCall!.totalTokens).toBe(3563);
      expect(writeFileSubCall!.totalPrice).toBe(0);

      const llmResponseSubCall = subagentEntry!.subCalls!.find(
        (sc) => sc.toolName === '(llm_response)',
      );
      expect(llmResponseSubCall).toBeDefined();
      expect(llmResponseSubCall!.callCount).toBe(1);
      expect(llmResponseSubCall!.totalTokens).toBe(3518);
      expect(llmResponseSubCall!.totalPrice).toBe(0);

      // files_write_file should NOT appear at top level
      const topLevelWriteFile = result.byTool.find(
        (t) => t.toolName === 'files_write_file',
      );
      expect(topLevelWriteFile).toBeUndefined();

      // (llm_response) should NOT appear at top level
      const topLevelLlmResponse = result.byTool.find(
        (t) => t.toolName === '(llm_response)',
      );
      expect(topLevelLlmResponse).toBeUndefined();

      // toolsAggregate should include only LLM request tokens (not toolTokenUsage, which
      // is an aggregate of already-counted subagent internal calls — adding it would double-count).
      // msg-parent-ai (100) + subagent-ai-1 (3563) + subagent-ai-2 (3518) + msg-answer-ai (80)
      expect(result.toolsAggregate.totalTokens).toBe(7261);
      expect(result.toolsAggregate.inputTokens).toBe(4100);
      expect(result.toolsAggregate.outputTokens).toBe(3161);
      // requestCount = only LLM requests
      // msg-parent-ai + subagent-ai-1 + subagent-ai-2 + msg-answer-ai = 4
      expect(result.toolsAggregate.requestCount).toBe(4);
    });

    it('should log warning and still count requests for subagent messages with unresolved parentToolCallId', async () => {
      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Done,
        externalThreadId: 'external-thread-123',
      });

      const mockTokenUsageFromCheckpoint = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        totalPrice: 0.01,
        byNode: {
          'node-1': {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            totalPrice: 0.01,
          },
        },
      };

      // Subagent internal AI message with __toolCallId pointing to unknown parent
      const unknownParentToolCallId = 'call_unknown_parent';
      const mockMessages = [
        createMockMessageEntity({
          id: 'msg-orphan-subagent',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          requestTokenUsage: undefined,
          additionalKwargs: {
            __hideForLlm: true,
            __toolCallId: unknownParentToolCallId,
            __requestUsage: {
              inputTokens: 2000,
              outputTokens: 500,
              totalTokens: 2500,
              totalPrice: 0,
            },
          },
        }),
      ];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);
      vi.spyOn(checkpointStateService, 'getThreadTokenUsage').mockResolvedValue(
        mockTokenUsageFromCheckpoint,
      );
      vi.spyOn(graphRegistry, 'getNodesByType').mockReturnValue([]);

      const result = await service.getThreadUsageStatistics(mockThreadId);

      // Should log a warning about unresolved parentToolCallId
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('parent tool not found'),
        expect.objectContaining({
          messageId: 'msg-orphan-subagent',
          parentToolCallId: unknownParentToolCallId,
        }),
      );

      // Subagent LLM call should still be counted in totalRequests and toolsAggregate
      expect(result.requests).toBe(1);
      expect(result.toolsAggregate.requestCount).toBe(1);
      expect(result.toolsAggregate.totalTokens).toBe(2500);

      // But should NOT appear in byTool (no parent to attribute to)
      expect(result.byTool).toHaveLength(0);
    });

    it('should use message-based total when it exceeds checkpoint total (in-progress subagent)', async () => {
      const mockThread = createMockThreadEntity({
        status: ThreadStatus.Running,
        externalThreadId: 'external-thread-123',
      });

      // Checkpoint only has the parent AI message cost — subagent hasn't finished yet
      const mockTokenUsageFromCheckpoint = {
        inputTokens: 60,
        outputTokens: 40,
        totalTokens: 100,
        totalPrice: 0.005,
        byNode: {
          'node-1': {
            inputTokens: 60,
            outputTokens: 40,
            totalTokens: 100,
            totalPrice: 0.005,
          },
        },
      };

      const parentToolCallId = 'call_inprogress_123';

      const mockMessages = [
        // 1. Parent AI message that calls subagents_run_task
        createMockMessageEntity({
          id: 'msg-parent-ai',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: ['subagents_run_task'],
          toolCallIds: [parentToolCallId],
          additionalKwargs: {},
          requestTokenUsage: {
            inputTokens: 60,
            outputTokens: 40,
            totalTokens: 100,
            totalPrice: 0.005,
          },
        }),
        // 2. Subagent internal AI message (streamed in real-time, subagent still running)
        createMockMessageEntity({
          id: 'msg-subagent-ai-1',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: ['files_read'],
          requestTokenUsage: undefined,
          additionalKwargs: {
            __hideForLlm: true,
            __toolCallId: parentToolCallId,
            __requestUsage: {
              inputTokens: 3000,
              outputTokens: 2000,
              totalTokens: 5000,
              totalPrice: 0.003,
            },
          },
        }),
        // 3. Subagent internal AI message (another LLM call, subagent still running)
        createMockMessageEntity({
          id: 'msg-subagent-ai-2',
          nodeId: 'node-1',
          role: MessageRole.AI,
          name: undefined,
          toolCallNames: [],
          requestTokenUsage: undefined,
          additionalKwargs: {
            __hideForLlm: true,
            __toolCallId: parentToolCallId,
            __requestUsage: {
              inputTokens: 4000,
              outputTokens: 1500,
              totalTokens: 5500,
              totalPrice: 0.004,
            },
          },
        }),
        // No tool result yet — subagent is still running
      ];

      vi.spyOn(threadsDao, 'getOne').mockResolvedValue(mockThread);
      vi.spyOn(messagesDao, 'getAll').mockResolvedValue(mockMessages);
      vi.spyOn(checkpointStateService, 'getThreadTokenUsage').mockResolvedValue(
        mockTokenUsageFromCheckpoint,
      );
      vi.spyOn(graphRegistry, 'getNodesByType').mockReturnValue([]);

      const result = await service.getThreadUsageStatistics(mockThreadId);

      // Message-based total: parent(60+40+100+0.005) + sub1(3000+2000+5000+0.003) + sub2(4000+1500+5500+0.004)
      // = {7060, 3540, 10600, 0.012}
      // Checkpoint total: {60, 40, 100, 0.005}
      // Math.max per field → message-based wins for all fields
      expect(result.total.inputTokens).toBe(7060);
      expect(result.total.outputTokens).toBe(3540);
      expect(result.total.totalTokens).toBe(10600);
      expect(result.total.totalPrice).toBeCloseTo(0.012, 4);

      // Subagent internal messages should still be counted in toolsAggregate
      expect(result.toolsAggregate.totalTokens).toBe(10600);
      expect(result.toolsAggregate.requestCount).toBe(3);
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
      vi.spyOn(checkpointStateService, 'getThreadTokenUsage').mockResolvedValue(
        mockTokenUsage,
      );

      // Mock graph registry to not find agent in memory (force checkpoint lookup)
      vi.spyOn(graphRegistry, 'getNodesByType').mockReturnValue([]);

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
