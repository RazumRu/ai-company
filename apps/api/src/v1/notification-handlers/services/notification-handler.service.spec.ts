import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, MockProxy } from 'vitest-mock-extended';

import { GraphStatus, MessageRole } from '../../graphs/graphs.types';
import {
  IAgentMessageNotification,
  IGraphNotification,
  NotificationEvent,
} from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationScope } from '../notification-handlers.types';
import {
  AgentMessageNotificationHandler,
  IAgentMessageEnrichedNotification,
} from './event-handlers/agent-message-notification-handler';
import {
  SimpleEnrichedNotification,
  SimpleEnrichmentHandler,
} from './event-handlers/simple-enrichment-handler';
import { NotificationHandler } from './notification-handler.service';

describe('NotificationHandler', () => {
  let service: NotificationHandler;
  let notificationsService: MockProxy<NotificationsService>;
  let simpleEnrichmentHandler: MockProxy<SimpleEnrichmentHandler>;
  let agentMessageEventHandler: MockProxy<AgentMessageNotificationHandler>;
  let logger: MockProxy<DefaultLogger>;

  const mockGraphId = 'graph-123';
  const mockOwnerId = 'user-456';
  const mockNodeId = 'node-789';
  const mockThreadId = 'thread-abc';

  const mockGraphSchema = {
    nodes: [
      {
        id: 'node-1',
        template: 'simple-agent',
        config: {},
      },
    ],
    metadata: {
      graphId: mockGraphId,
      version: '1.0.0',
      name: 'Test Graph',
    },
  };

  beforeEach(async () => {
    notificationsService = mockDeep<NotificationsService>();
    simpleEnrichmentHandler = mockDeep<SimpleEnrichmentHandler>();
    agentMessageEventHandler = mockDeep<AgentMessageNotificationHandler>();
    logger = mockDeep<DefaultLogger>();

    // Set up mock pattern properties using Object.defineProperty
    Object.defineProperty(simpleEnrichmentHandler, 'pattern', {
      value: [
        NotificationEvent.Graph,
        NotificationEvent.GraphNodeUpdate,
        NotificationEvent.AgentStateUpdate,
      ],
      writable: true,
    });
    Object.defineProperty(agentMessageEventHandler, 'pattern', {
      value: NotificationEvent.AgentMessage,
      writable: true,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationHandler,
        {
          provide: NotificationsService,
          useValue: notificationsService,
        },
        {
          provide: DefaultLogger,
          useValue: logger,
        },
      ],
    }).compile();

    service = module.get<NotificationHandler>(NotificationHandler);
  });

  describe('registerHandler + init', () => {
    it('should register handlers and subscribe to notifications service', async () => {
      service.registerHandler(simpleEnrichmentHandler);
      service.registerHandler(agentMessageEventHandler);
      await service.init();

      expect(notificationsService.subscribe).toHaveBeenCalledTimes(1);

      // Verify handlers were registered by dispatching events of different types
      // and confirming the correct handler is invoked.
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]![0];

      simpleEnrichmentHandler.handle.mockResolvedValue([]);
      agentMessageEventHandler.handle.mockResolvedValue([]);

      await subscribeCallback({
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      });
      expect(simpleEnrichmentHandler.handle).toHaveBeenCalledTimes(1);
      expect(agentMessageEventHandler.handle).not.toHaveBeenCalled();

      await subscribeCallback({
        type: NotificationEvent.AgentMessage,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        parentThreadId: 'parent-thread-123',
        data: { messages: [] },
      });
      expect(agentMessageEventHandler.handle).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleNotification', () => {
    beforeEach(async () => {
      // Register handlers and initialize the service
      service.registerHandler(simpleEnrichmentHandler);
      service.registerHandler(agentMessageEventHandler);
      await service.init();
    });

    it('should handle graph notification and emit enriched notification', async () => {
      const mockEnrichedNotification: SimpleEnrichedNotification = {
        type: NotificationEvent.Graph,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      simpleEnrichmentHandler.handle.mockResolvedValue([
        mockEnrichedNotification,
      ]);

      const mockNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      const callback = vi.fn();
      service.onEnrichedNotification(callback);

      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      expect(subscribeCallback).toBeDefined();
      await subscribeCallback!(mockNotification);

      expect(simpleEnrichmentHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(callback).toHaveBeenCalledWith(mockEnrichedNotification);
    });

    it('should handle agent message notification and emit message event', async () => {
      const mockMessageNotification: IAgentMessageEnrichedNotification = {
        type: NotificationEvent.AgentMessage,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        internalThreadId: 'internal-thread-123',
        data: {
          id: 'message-123',
          threadId: 'thread-123',
          nodeId: mockNodeId,
          externalThreadId: 'external-thread-123',
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z',
          message: {
            role: MessageRole.AI,
            content: 'Hello, world!',
          },
        },
      };

      agentMessageEventHandler.handle.mockResolvedValue([
        mockMessageNotification,
      ]);

      const mockMessages = [new AIMessage('Hello, world!')];
      const mockNotification: IAgentMessageNotification = {
        type: NotificationEvent.AgentMessage,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        parentThreadId: 'parent-thread-123',
        data: {
          messages: mockMessages,
        },
      };

      const callback = vi.fn();
      service.onEnrichedNotification(callback);

      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      expect(subscribeCallback).toBeDefined();
      await subscribeCallback!(mockNotification);

      expect(agentMessageEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(callback).toHaveBeenCalledWith(mockMessageNotification);
    });

    it('should handle agent message notification with AI message and tool calls', async () => {
      const mockMessageNotification: IAgentMessageEnrichedNotification = {
        type: NotificationEvent.AgentMessage,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        internalThreadId: 'internal-thread-123',
        data: {
          id: 'message-124',
          threadId: 'thread-124',
          nodeId: mockNodeId,
          externalThreadId: 'external-thread-124',
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z',
          message: {
            role: MessageRole.AI,
            content: '',
            id: 'msg-123',
            toolCalls: [
              {
                name: 'get_weather',
                args: { city: 'San Francisco' },
                type: 'tool_call',
                id: 'call-123',
              },
            ],
          },
        },
      };

      agentMessageEventHandler.handle.mockResolvedValue([
        mockMessageNotification,
      ]);

      const mockMessages = [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              name: 'get_weather',
              args: { city: 'San Francisco' },
              id: 'call-123',
            },
          ],
        }),
      ];
      const mockNotification: IAgentMessageNotification = {
        type: NotificationEvent.AgentMessage,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        parentThreadId: 'parent-thread-123',
        data: {
          messages: mockMessages,
        },
      };

      const callback = vi.fn();
      service.onEnrichedNotification(callback);

      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      expect(subscribeCallback).toBeDefined();
      await subscribeCallback!(mockNotification);

      expect(agentMessageEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(callback).toHaveBeenCalledWith(mockMessageNotification);
    });

    it('should handle agent message notification and emit multiple events', async () => {
      const mockMessageNotification: IAgentMessageEnrichedNotification = {
        type: NotificationEvent.AgentMessage,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        internalThreadId: 'internal-thread-123',
        data: {
          id: 'message-125',
          threadId: 'thread-125',
          nodeId: mockNodeId,
          externalThreadId: 'external-thread-125',
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z',
          message: {
            role: MessageRole.AI,
            content: 'Hello!',
          },
        },
      };

      const mockMessageNotification2: IAgentMessageEnrichedNotification = {
        type: NotificationEvent.AgentMessage,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        internalThreadId: 'internal-thread-123',
        data: {
          id: 'message-126',
          threadId: 'thread-126',
          nodeId: mockNodeId,
          externalThreadId: 'external-thread-126',
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z',
          message: {
            role: MessageRole.Human,
            content: 'Hi!',
          },
        },
      };

      agentMessageEventHandler.handle.mockResolvedValue([
        mockMessageNotification,
        mockMessageNotification2,
      ]);

      const mockMessages = [new AIMessage('Hello!'), new HumanMessage('Hi!')];
      const mockNotification: IAgentMessageNotification = {
        type: NotificationEvent.AgentMessage,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        parentThreadId: 'parent-thread-123',
        data: {
          messages: mockMessages,
        },
      };

      const callback = vi.fn();
      service.onEnrichedNotification(callback);

      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      expect(subscribeCallback).toBeDefined();
      await subscribeCallback!(mockNotification);

      expect(agentMessageEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenNthCalledWith(1, mockMessageNotification);
      expect(callback).toHaveBeenNthCalledWith(2, mockMessageNotification2);
    });

    it('should handle agent message notification and emit shell tool message', async () => {
      const mockMessageNotification: IAgentMessageEnrichedNotification = {
        type: NotificationEvent.AgentMessage,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        internalThreadId: 'internal-thread-123',
        data: {
          id: 'message-127',
          threadId: 'thread-127',
          nodeId: mockNodeId,
          externalThreadId: 'external-thread-127',
          createdAt: '2023-01-01T00:00:00Z',
          updatedAt: '2023-01-01T00:00:00Z',
          message: {
            role: MessageRole.Tool,
            name: 'shell',
            content: {
              exitCode: 0,
              stdout: 'Command output',
              stderr: '',
            },
            toolCallId: 'call-shell-1',
          },
        },
      };

      agentMessageEventHandler.handle.mockResolvedValue([
        mockMessageNotification,
      ]);

      const mockMessages = [
        new ToolMessage({
          content: JSON.stringify({
            exitCode: 0,
            stdout: 'Command output',
            stderr: '',
            cmd: 'echo test',
          }),
          tool_call_id: 'call-shell-1',
          name: 'shell',
        }),
      ];
      const mockNotification: IAgentMessageNotification = {
        type: NotificationEvent.AgentMessage,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        parentThreadId: 'parent-thread-123',
        data: {
          messages: mockMessages,
        },
      };

      const callback = vi.fn();
      service.onEnrichedNotification(callback);

      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      expect(subscribeCallback).toBeDefined();
      await subscribeCallback!(mockNotification);

      expect(agentMessageEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(callback).toHaveBeenCalledWith(mockMessageNotification);
    });

    it('should process multiple notifications', async () => {
      const mockEnrichedNotification: SimpleEnrichedNotification = {
        type: NotificationEvent.Graph,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      simpleEnrichmentHandler.handle.mockResolvedValue([
        mockEnrichedNotification,
      ]);

      const mockNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      const callback = vi.fn();
      service.onEnrichedNotification(callback);

      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      expect(subscribeCallback).toBeDefined();

      // First call
      await subscribeCallback!(mockNotification);
      expect(simpleEnrichmentHandler.handle).toHaveBeenCalledTimes(1);

      // Second call
      await subscribeCallback!(mockNotification);
      expect(simpleEnrichmentHandler.handle).toHaveBeenCalledTimes(2);
    });

    it('should handle empty results from event handler', async () => {
      simpleEnrichmentHandler.handle.mockResolvedValue([]);

      const mockNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      const callback = vi.fn();
      service.onEnrichedNotification(callback);

      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      expect(subscribeCallback).toBeDefined();
      await subscribeCallback!(mockNotification);

      expect(simpleEnrichmentHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('onEnrichedNotification', () => {
    it('should register a callback that receives enriched notifications', async () => {
      service.registerHandler(simpleEnrichmentHandler);
      await service.init();

      const mockEnrichedNotification: SimpleEnrichedNotification = {
        type: NotificationEvent.Graph,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      simpleEnrichmentHandler.handle.mockResolvedValue([
        mockEnrichedNotification,
      ]);

      const callback = vi.fn();
      service.onEnrichedNotification(callback);

      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]![0];
      await subscribeCallback({
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      });

      expect(callback).toHaveBeenCalledWith(mockEnrichedNotification);
    });

    it('should replace previous callback when called again', async () => {
      service.registerHandler(simpleEnrichmentHandler);
      await service.init();

      const mockEnrichedNotification: SimpleEnrichedNotification = {
        type: NotificationEvent.Graph,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      simpleEnrichmentHandler.handle.mockResolvedValue([
        mockEnrichedNotification,
      ]);

      const firstCallback = vi.fn();
      const secondCallback = vi.fn();
      service.onEnrichedNotification(firstCallback);
      service.onEnrichedNotification(secondCallback);

      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]![0];
      await subscribeCallback({
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      });

      expect(firstCallback).not.toHaveBeenCalled();
      expect(secondCallback).toHaveBeenCalledWith(mockEnrichedNotification);
    });
  });
});
