import { AIMessage, ToolMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { MessageTransformerService } from '../../../graphs/services/message-transformer.service';
import type { MessageTokenUsage } from '../../../litellm/litellm.types';
import { LitellmService } from '../../../litellm/services/litellm.service';
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
  let litellmService: LitellmService;

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
                tokenUsage: record.tokenUsage,
                createdAt: new Date('2024-01-01T00:00:00Z'),
                updatedAt: new Date('2024-01-01T00:00:00Z'),
              };
            }),
          },
        },
        {
          provide: LitellmService,
          useValue: {
            extractMessageTokenUsageFromAdditionalKwargs: vi.fn(),
            attachTokenUsageToMessage: vi.fn(),
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
    litellmService = module.get<LitellmService>(LitellmService);
  });

  it('computes tokenUsage for tool response messages', async () => {
    const internalThread = createMockThreadEntity();
    vi.spyOn(threadsDao, 'getOne').mockResolvedValue(internalThread);

    const aiTokenUsage = { totalTokens: 192, totalPrice: 0.0003 };
    const toolTokenUsage = { totalTokens: 500, totalPrice: 0.001 };
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
        tokenUsage: aiTokenUsage,
      },
    });

    const tool = new ToolMessage({
      content: JSON.stringify({ exitCode: 0, stdout: 'ok', stderr: '' }),
      tool_call_id: toolCallId,
      name: 'shell',
    });
    Object.assign(tool, {
      additional_kwargs: {
        __model: 'openai/gpt-5.2',
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

    vi.spyOn(
      litellmService,
      'extractMessageTokenUsageFromAdditionalKwargs',
    ).mockImplementation((kwargs?: { tokenUsage?: unknown } | null) => {
      const usage = kwargs?.tokenUsage;
      if (
        typeof usage === 'object' &&
        usage !== null &&
        typeof (usage as { totalTokens?: unknown }).totalTokens === 'number'
      ) {
        return usage as MessageTokenUsage;
      }
      return null;
    });
    vi.spyOn(litellmService, 'attachTokenUsageToMessage').mockResolvedValue(
      toolTokenUsage,
    );

    await handler.handle(notification);

    expect(graphDao.getOne).toHaveBeenCalledWith({ id: mockGraphId });
    expect(threadsDao.getOne).toHaveBeenCalledWith({
      externalThreadId: mockParentThreadId,
    });

    expect(messagesDao.create).toHaveBeenCalledTimes(2);

    const firstCreate = (
      messagesDao.create as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as Record<string, unknown>;
    const secondCreate = (
      messagesDao.create as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[1]?.[0] as Record<string, unknown>;

    expect(firstCreate.tokenUsage).toEqual(aiTokenUsage);
    expect(secondCreate.tokenUsage).toEqual(toolTokenUsage);
  });
});
