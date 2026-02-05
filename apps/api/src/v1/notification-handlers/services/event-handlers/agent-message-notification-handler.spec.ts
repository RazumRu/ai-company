import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { MessageTransformerService } from '../../../graphs/services/message-transformer.service';
import type { IAgentMessageNotification } from '../../../notifications/notifications.types';
import { NotificationEvent } from '../../../notifications/notifications.types';
import { serializeBaseMessages } from '../../../notifications/notifications.utils';
import { MessagesDao } from '../../../threads/dao/messages.dao';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import { AgentMessageNotificationHandler } from './agent-message-notification-handler';

describe('AgentMessageNotificationHandler', () => {
  let handler: AgentMessageNotificationHandler;
  let threadsDao: ThreadsDao;
  let messagesDao: MessagesDao;
  let graphDao: GraphDao;

  const mockGraphId = 'graph-123';
  const mockNodeId = 'node-456';
  const mockThreadId = 'thread-external-789';
  const mockParentThreadId = 'thread-parent-000';
  const mockOwnerId = 'user-999';

  const createMockThreadEntity = (
    overrides: Partial<ThreadEntity> = {},
  ): ThreadEntity => ({
    id: '11111111-1111-4111-8111-111111111111',
    graphId: mockGraphId,
    createdBy: mockOwnerId,
    externalThreadId: mockParentThreadId,
    metadata: {},
    lastRunId: undefined,
    status: 'running' as ThreadEntity['status'],
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentMessageNotificationHandler,
        MessageTransformerService,
        {
          provide: GraphDao,
          useValue: {
            getOne: vi.fn().mockResolvedValue({
              id: mockGraphId,
              createdBy: mockOwnerId,
            }),
          },
        },
        {
          provide: ThreadsDao,
          useValue: {
            getOne: vi.fn(),
          },
        },
        {
          provide: MessagesDao,
          useValue: {
            create: vi.fn().mockImplementation(async (data: unknown) => {
              const record = data as Record<string, unknown>;
              return {
                id: '22222222-2222-4222-8222-222222222222',
                threadId: record.threadId,
                externalThreadId: record.externalThreadId,
                nodeId: record.nodeId,
                message: record.message,
                requestTokenUsage: record.requestTokenUsage,
                createdAt: new Date('2024-01-01T00:00:00Z'),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
              };
            }),
            createMany: vi
              .fn()
              .mockImplementation(async (dataArray: unknown[]) => {
                return dataArray.map((data) => {
                  const record = data as Record<string, unknown>;
                  return {
                    id: '22222222-2222-4222-8222-222222222222',
                    threadId: record.threadId,
                    externalThreadId: record.externalThreadId,
                    nodeId: record.nodeId,
                    message: record.message,
                    requestTokenUsage: record.requestTokenUsage,
                    role: record.role,
                    name: record.name,
                    toolCallNames: record.toolCallNames,
                    answeredToolCallNames: record.answeredToolCallNames,
                    createdAt: new Date('2024-01-01T00:00:00Z'),
                    updatedAt: new Date('2024-01-01T00:00:00Z'),
                  };
                });
              }),
          },
        },
        {
          provide: DefaultLogger,
          useValue: {
            warn: vi.fn(),
            error: vi.fn(),
            info: vi.fn(),
            debug: vi.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get<AgentMessageNotificationHandler>(
      AgentMessageNotificationHandler,
    );
    threadsDao = module.get<ThreadsDao>(ThreadsDao);
    messagesDao = module.get<MessagesDao>(MessagesDao);
    graphDao = module.get<GraphDao>(GraphDao);
  });

  it('saves requestTokenUsage only for AI messages, not for tool messages', async () => {
    const internalThread = createMockThreadEntity();
    vi.spyOn(threadsDao, 'getOne').mockResolvedValue(internalThread);

    const aiTokenUsage = {
      inputTokens: 100,
      outputTokens: 92,
      totalTokens: 192,
      totalPrice: 0.0003,
    };
    const toolCallId = 'call_shell_1';

    const ai = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: toolCallId,
          type: 'tool_call',
          name: 'shell',
          args: { cmd: 'pwd' },
        },
      ],
      additional_kwargs: {
        __requestUsage: aiTokenUsage, // Full request-level token usage
        __tokenUsage: { totalTokens: 192, totalPrice: 0.0003 }, // Message-level usage
      },
    });

    const tool = new ToolMessage({
      content: JSON.stringify({ exitCode: 0, stdout: 'ok', stderr: '' }),
      tool_call_id: toolCallId,
      name: 'shell',
    });
    // Tool message should only have __tokenUsage (for counting tokens),
    // NOT __requestUsage (it's not from an LLM request)
    Object.assign(tool, {
      additional_kwargs: {
        __model: 'openai/gpt-5.2',
        __tokenUsage: { totalTokens: 500, totalPrice: 0.001 }, // Message-level usage
      },
    });

    const notification: IAgentMessageNotification = {
      type: NotificationEvent.AgentMessage,
      graphId: mockGraphId,
      nodeId: mockNodeId,
      threadId: mockThreadId,
      parentThreadId: mockParentThreadId,
      data: {
        messages: serializeBaseMessages([ai, tool]),
      },
    };

    await handler.handle(notification);

    expect(graphDao.getOne).toHaveBeenCalledWith({ id: mockGraphId });
    expect(threadsDao.getOne).toHaveBeenCalledWith({
      externalThreadId: mockParentThreadId,
    });

    expect(messagesDao.createMany).toHaveBeenCalledTimes(1);

    const createManyCall = (
      messagesDao.createMany as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as Record<string, unknown>[];

    expect(createManyCall).toHaveLength(2);

    // AI message should have requestTokenUsage (from LLM request)
    expect(createManyCall[0]?.requestTokenUsage).toEqual(aiTokenUsage);

    // Tool message should NOT have requestTokenUsage (it's a function execution result, not an LLM response)
    expect(createManyCall[1]?.requestTokenUsage).toBeUndefined();
  });

  it('AI messages have __requestUsage, tool messages do not', async () => {
    const internalThread = createMockThreadEntity();
    vi.spyOn(threadsDao, 'getOne').mockResolvedValue(internalThread);

    const toolCallId = 'call_test_123';
    const requestUsage = {
      inputTokens: 13780,
      outputTokens: 37,
      totalTokens: 13817,
      cachedInputTokens: 13696,
      reasoningTokens: 0,
      totalPrice: 0.0030618,
      currentContext: 13780,
    };

    // AI message with __requestUsage (from LLM request)
    const ai = new AIMessage({
      content: '',
      tool_calls: [
        {
          id: toolCallId,
          type: 'tool_call',
          name: 'finish',
          args: { message: 'Test' },
        },
      ],
      additional_kwargs: {
        __model: 'azure/gpt-5.2',
        __tokenUsage: {
          totalTokens: 61,
          totalPrice: 0.000013517391619020047,
        },
        __requestUsage: requestUsage,
      },
    });

    // Tool message should only have __tokenUsage, NOT __requestUsage
    // (it's a function execution result, not an LLM response)
    const tool = new ToolMessage({
      content: JSON.stringify({ success: true }),
      tool_call_id: toolCallId,
      name: 'finish',
    });
    Object.assign(tool, {
      additional_kwargs: {
        __model: 'azure/gpt-5.2',
        __tokenUsage: {
          totalTokens: 23,
          totalPrice: 0.00004025,
        },
        // No __requestUsage for tool messages
      },
    });

    const notification: IAgentMessageNotification = {
      type: NotificationEvent.AgentMessage,
      graphId: mockGraphId,
      nodeId: mockNodeId,
      threadId: mockThreadId,
      parentThreadId: mockParentThreadId,
      data: {
        messages: serializeBaseMessages([ai, tool]),
      },
    };

    await handler.handle(notification);

    // Verify messagesDao.createMany was called once with an array of 2 messages
    expect(messagesDao.createMany).toHaveBeenCalledTimes(1);

    const createManyCall = (
      messagesDao.createMany as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as Record<string, unknown>[];

    expect(createManyCall).toHaveLength(2);

    // Check AI message - should have requestTokenUsage from LLM request
    const aiCreateData = createManyCall[0];
    expect(aiCreateData?.requestTokenUsage).toEqual(requestUsage);
    expect(aiCreateData?.toolCallNames).toEqual(['finish']);
    expect(aiCreateData?.role).toBe('ai');

    // Check Tool message - should NOT have requestTokenUsage
    // (it's a function execution result, not an LLM response)
    const toolCreateData = createManyCall[1];
    expect(toolCreateData?.requestTokenUsage).toBeUndefined();
    expect(toolCreateData?.toolCallNames).toBeUndefined();
    expect(toolCreateData?.role).toBe('tool');
    expect(toolCreateData?.name).toBe('finish');
  });

  it('does not save requestTokenUsage for human messages', async () => {
    const internalThread = createMockThreadEntity();
    vi.spyOn(threadsDao, 'getOne').mockResolvedValue(internalThread);

    // Human message (user input - should NOT have requestTokenUsage)
    const human = new HumanMessage({
      content: 'Hello, how are you?',
    });

    // AI response (should have requestTokenUsage)
    const aiTokenUsage = {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
      totalPrice: 0.001,
    };
    const ai = new AIMessage({
      content: 'I am doing well, thank you!',
      additional_kwargs: {
        __requestUsage: aiTokenUsage,
      },
    });

    const notification: IAgentMessageNotification = {
      type: NotificationEvent.AgentMessage,
      graphId: mockGraphId,
      nodeId: mockNodeId,
      threadId: mockThreadId,
      parentThreadId: mockParentThreadId,
      data: {
        messages: serializeBaseMessages([human, ai]),
      },
    };

    await handler.handle(notification);

    expect(messagesDao.createMany).toHaveBeenCalledTimes(1);

    const createManyCall = (
      messagesDao.createMany as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as Record<string, unknown>[];

    expect(createManyCall).toHaveLength(2);

    // Check human message - should NOT have requestTokenUsage
    const humanCreateData = createManyCall[0];
    expect(humanCreateData?.requestTokenUsage).toBeUndefined();
    expect(humanCreateData?.toolCallNames).toBeUndefined();
    expect(humanCreateData?.role).toBe('human');

    // Check AI message - SHOULD have requestTokenUsage (no tool calls)
    const aiCreateData = createManyCall[1];
    expect(aiCreateData?.requestTokenUsage).toEqual(aiTokenUsage);
    expect(aiCreateData?.toolCallNames).toBeUndefined(); // No toolCalls in this AI message
    expect(aiCreateData?.role).toBe('ai');
  });
});
