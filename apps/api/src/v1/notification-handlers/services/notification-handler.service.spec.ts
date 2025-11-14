import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, MockProxy } from 'vitest-mock-extended';

import { GraphStatus } from '../../graphs/graphs.types';
import {
  IAgentMessageNotification,
  IGraphNotification,
  NotificationEvent,
} from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import {
  EnrichedNotificationEvent,
  NotificationScope,
} from '../notification-handlers.types';
import {
  AgentMessageNotificationHandler,
  IAgentMessageEnrichedNotification,
} from './event-handlers/agent-message-notification-handler';
import {
  GraphNotificationHandler,
  IGraphEnrichedNotification,
} from './event-handlers/graph-notification-handler';
import { NotificationHandler } from './notification-handler.service';

describe('NotificationHandler', () => {
  let service: NotificationHandler;
  let notificationsService: MockProxy<NotificationsService>;
  let graphEventHandler: MockProxy<GraphNotificationHandler>;
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

  const _mockCheckpoint = {
    v: 1,
    ts: '2023-01-01T00:00:00.000Z',
    id: 'checkpoint-1',
    channel_values: {},
    channel_versions: {},
    versions_seen: {},
  };

  const _mockCheckpointMetadata = {
    source: 'update' as const,
    step: 1,
    parents: {},
  };

  beforeEach(async () => {
    notificationsService = mockDeep<NotificationsService>();
    graphEventHandler = mockDeep<GraphNotificationHandler>();
    agentMessageEventHandler = mockDeep<AgentMessageNotificationHandler>();
    logger = mockDeep<DefaultLogger>();

    // Set up mock pattern properties using Object.defineProperty
    Object.defineProperty(graphEventHandler, 'pattern', {
      value: NotificationEvent.Graph,
      writable: true,
    });
    Object.defineProperty(agentMessageEventHandler, 'pattern', {
      value: NotificationEvent.AgentMessage,
      writable: true,
    });

    // Set up mock constructor names
    Object.defineProperty(graphEventHandler, 'constructor', {
      value: { name: 'GraphNotificationHandler' },
      writable: true,
    });
    Object.defineProperty(agentMessageEventHandler, 'constructor', {
      value: { name: 'AgentMessageNotificationHandler' },
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
          provide: GraphNotificationHandler,
          useValue: graphEventHandler,
        },
        {
          provide: AgentMessageNotificationHandler,
          useValue: agentMessageEventHandler,
        },
        {
          provide: DefaultLogger,
          useValue: logger,
        },
      ],
    }).compile();

    service = module.get<NotificationHandler>(NotificationHandler);
  });

  describe('registerHandler', () => {
    it('should register event handlers', () => {
      service.registerHandler(graphEventHandler);
      service.registerHandler(agentMessageEventHandler);
    });
  });

  describe('init', () => {
    it('should initialize and subscribe to notifications service', async () => {
      await service.init();

      expect(notificationsService.subscribe).toHaveBeenCalled();
    });
  });

  describe('handleNotification', () => {
    beforeEach(async () => {
      // Register handlers for testing
      service.registerHandler(graphEventHandler);
      service.registerHandler(agentMessageEventHandler);

      // Initialize the service to set up the subscription
      await service.init();
    });

    it('should handle graph notification and emit enriched notification', async () => {
      const mockEnrichedNotification: IGraphEnrichedNotification = {
        type: EnrichedNotificationEvent.Graph,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      graphEventHandler.handle.mockResolvedValue([mockEnrichedNotification]);

      const mockNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      let emittedEvent: unknown;
      service.on('enriched_notification', (event) => {
        emittedEvent = event;
      });

      // Get the subscribe callback and call it
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        await subscribeCallback(mockNotification);
      }

      expect(graphEventHandler.handle).toHaveBeenCalledWith(mockNotification);
      expect(emittedEvent).toEqual(mockEnrichedNotification);
    });

    it('should handle agent message notification and emit message event', async () => {
      const mockMessageNotification: IAgentMessageEnrichedNotification = {
        type: EnrichedNotificationEvent.AgentMessage,
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
            role: 'ai',
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

      let emittedEvent: unknown;
      service.on('enriched_notification', (event) => {
        emittedEvent = event;
      });

      // Get the subscribe callback and call it
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        await subscribeCallback(mockNotification);
      }

      expect(agentMessageEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(emittedEvent).toEqual(mockMessageNotification);
    });

    it('should handle agent message notification with AI message and tool calls', async () => {
      const mockMessageNotification: IAgentMessageEnrichedNotification = {
        type: EnrichedNotificationEvent.AgentMessage,
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
            role: 'ai',
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

      let emittedEvent: unknown;
      service.on('enriched_notification', (event) => {
        emittedEvent = event;
      });

      // Get the subscribe callback and call it
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        await subscribeCallback(mockNotification);
      }

      expect(agentMessageEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(emittedEvent).toEqual(mockMessageNotification);
    });

    it('should handle agent message notification and emit multiple events', async () => {
      const mockMessageNotification: IAgentMessageEnrichedNotification = {
        type: EnrichedNotificationEvent.AgentMessage,
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
            role: 'ai',
            content: 'Hello!',
          },
        },
      };

      const mockMessageNotification2: IAgentMessageEnrichedNotification = {
        type: EnrichedNotificationEvent.AgentMessage,
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
            role: 'human',
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

      const emittedEvents: unknown[] = [];
      service.on('enriched_notification', (event) => {
        emittedEvents.push(event);
      });

      // Get the subscribe callback and call it
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        await subscribeCallback(mockNotification);
      }

      expect(agentMessageEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(emittedEvents).toHaveLength(2);
      expect(emittedEvents[0]).toEqual(mockMessageNotification);
      expect(emittedEvents[1]).toEqual(mockMessageNotification2);
    });

    it('should handle agent message notification and emit shell tool message', async () => {
      const mockMessageNotification: IAgentMessageEnrichedNotification = {
        type: EnrichedNotificationEvent.AgentMessage,
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
            role: 'tool-shell',
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

      let emittedEvent: unknown;
      service.on('enriched_notification', (event) => {
        emittedEvent = event;
      });

      // Get the subscribe callback and call it
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        await subscribeCallback(mockNotification);
      }

      expect(agentMessageEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(emittedEvent).toEqual(mockMessageNotification);
    });

    it('should process multiple notifications', async () => {
      const mockEnrichedNotification: IGraphEnrichedNotification = {
        type: EnrichedNotificationEvent.Graph,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      graphEventHandler.handle.mockResolvedValue([mockEnrichedNotification]);

      const mockNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      const emittedEvents: unknown[] = [];
      service.on('enriched_notification', (event) => {
        emittedEvents.push(event);
      });

      // Get the subscribe callback
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        // First call
        await subscribeCallback(mockNotification);
        expect(graphEventHandler.handle).toHaveBeenCalledTimes(1);

        // Second call
        await subscribeCallback(mockNotification);
        expect(graphEventHandler.handle).toHaveBeenCalledTimes(2);
      }
    });

    it('should handle empty results from event handler', async () => {
      graphEventHandler.handle.mockResolvedValue([]);

      const mockNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      const emittedEvents: unknown[] = [];
      service.on('enriched_notification', (event) => {
        emittedEvents.push(event);
      });

      // Get the subscribe callback and call it
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        await subscribeCallback(mockNotification);
      }

      expect(graphEventHandler.handle).toHaveBeenCalledWith(mockNotification);
      expect(emittedEvents).toHaveLength(0);
    });
  });

  describe('subscribeEvents', () => {
    it('should allow subscribing to enriched notifications', () => {
      const callback = vi.fn();
      service.subscribeEvents(callback);

      // Emit a test event
      const testEvent: IGraphEnrichedNotification = {
        type: EnrichedNotificationEvent.Graph,
        scope: [NotificationScope.Graph],
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        data: { status: GraphStatus.Running, schema: mockGraphSchema },
      };

      service.emit('enriched_notification', testEvent);

      expect(callback).toHaveBeenCalledWith(testEvent);
    });
  });
});
