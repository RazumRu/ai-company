import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, MockProxy } from 'vitest-mock-extended';

import {
  ICheckpointerNotification,
  IGraphNotification,
  NotificationEvent,
} from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { EnrichedNotificationEvent } from '../notification-handlers.types';
import {
  CheckpointerNotificationHandler,
  ICheckpointerEnrichedNotification,
  ICheckpointerMessageEnrichedNotification,
  ICheckpointerToolCallEnrichedNotification,
} from './event-handlers/checkpointer-notification-handler';
import {
  GraphNotificationHandler,
  IGraphEnrichedNotification,
} from './event-handlers/graph-notification-handler';
import { NotificationHandler } from './notification-handler.service';

describe('NotificationHandler', () => {
  let service: NotificationHandler;
  let notificationsService: MockProxy<NotificationsService>;
  let graphEventHandler: MockProxy<GraphNotificationHandler>;
  let checkpointerEventHandler: MockProxy<CheckpointerNotificationHandler>;
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

  const mockCheckpoint = {
    v: 1,
    ts: '2023-01-01T00:00:00.000Z',
    id: 'checkpoint-1',
    channel_values: {},
    channel_versions: {},
    versions_seen: {},
  };

  const mockCheckpointMetadata = {
    source: 'update' as const,
    step: 1,
    parents: {},
  };

  beforeEach(async () => {
    notificationsService = mockDeep<NotificationsService>();
    graphEventHandler = mockDeep<GraphNotificationHandler>();
    checkpointerEventHandler = mockDeep<CheckpointerNotificationHandler>();
    logger = mockDeep<DefaultLogger>();

    // Set up mock pattern properties using Object.defineProperty
    Object.defineProperty(graphEventHandler, 'pattern', {
      value: NotificationEvent.Graph,
      writable: true,
    });
    Object.defineProperty(checkpointerEventHandler, 'pattern', {
      value: NotificationEvent.Checkpointer,
      writable: true,
    });

    // Set up mock constructor names
    Object.defineProperty(graphEventHandler, 'constructor', {
      value: { name: 'GraphNotificationHandler' },
      writable: true,
    });
    Object.defineProperty(checkpointerEventHandler, 'constructor', {
      value: { name: 'CheckpointerNotificationHandler' },
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
          provide: CheckpointerNotificationHandler,
          useValue: checkpointerEventHandler,
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
      service.registerHandler(checkpointerEventHandler);

      expect(logger.log).toHaveBeenCalledWith('Event handler registered', {
        type: NotificationEvent.Graph,
        handlerName: 'GraphNotificationHandler',
      });
      expect(logger.log).toHaveBeenCalledWith('Event handler registered', {
        type: NotificationEvent.Checkpointer,
        handlerName: 'CheckpointerNotificationHandler',
      });
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
      service.registerHandler(checkpointerEventHandler);

      // Initialize the service to set up the subscription
      await service.init();
    });

    it('should handle graph notification and emit enriched notification', async () => {
      const mockEnrichedNotification: IGraphEnrichedNotification = {
        type: EnrichedNotificationEvent.Graph,
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        data: { state: 'compiled', schema: mockGraphSchema },
      };

      graphEventHandler.handle.mockResolvedValue([mockEnrichedNotification]);

      const mockNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { state: 'compiled', schema: mockGraphSchema },
      };

      let emittedEvent: any;
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

    it('should handle checkpointer notification and emit enriched notification', async () => {
      const mockEnrichedNotification: ICheckpointerEnrichedNotification = {
        type: EnrichedNotificationEvent.Checkpointer,
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        data: {
          action: 'put',
          checkpoint: mockCheckpoint,
          metadata: mockCheckpointMetadata,
        },
      };

      checkpointerEventHandler.handle.mockResolvedValue([
        mockEnrichedNotification,
      ]);

      const mockNotification: ICheckpointerNotification = {
        type: NotificationEvent.Checkpointer,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        data: {
          action: 'put',
          checkpoint: mockCheckpoint,
          metadata: mockCheckpointMetadata,
        },
      };

      let emittedEvent: any;
      service.on('enriched_notification', (event) => {
        emittedEvent = event;
      });

      // Get the subscribe callback and call it
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        await subscribeCallback(mockNotification);
      }

      expect(checkpointerEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(emittedEvent).toEqual(mockEnrichedNotification);
    });

    it('should handle checkpointer notification and emit message event', async () => {
      const mockMessageNotification: ICheckpointerMessageEnrichedNotification =
        {
          type: EnrichedNotificationEvent.CheckpointerMessage,
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: {
            content: 'Hello, world!',
            role: 'ai',
          },
        };

      checkpointerEventHandler.handle.mockResolvedValue([
        mockMessageNotification,
      ]);

      const mockNotification: ICheckpointerNotification = {
        type: NotificationEvent.Checkpointer,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        data: {
          action: 'putWrites',
          writes: [
            {
              channel: 'messages',
              value: {
                type: 'ai',
                content: 'Hello, world!',
              },
            },
          ],
        },
      };

      let emittedEvent: any;
      service.on('enriched_notification', (event) => {
        emittedEvent = event;
      });

      // Get the subscribe callback and call it
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        await subscribeCallback(mockNotification);
      }

      expect(checkpointerEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(emittedEvent).toEqual(mockMessageNotification);
    });

    it('should handle checkpointer notification and emit tool call event', async () => {
      const mockToolCallNotification: ICheckpointerToolCallEnrichedNotification =
        {
          type: EnrichedNotificationEvent.CheckpointerToolCall,
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: {
            name: 'get_weather',
            args: { city: 'San Francisco' },
            id: 'call-123',
          },
        };

      checkpointerEventHandler.handle.mockResolvedValue([
        mockToolCallNotification,
      ]);

      const mockNotification: ICheckpointerNotification = {
        type: NotificationEvent.Checkpointer,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        data: {
          action: 'putWrites',
          writes: [
            {
              channel: 'messages',
              value: {
                type: 'ai',
                tool_calls: [
                  {
                    name: 'get_weather',
                    args: { city: 'San Francisco' },
                    id: 'call-123',
                  },
                ],
              },
            },
          ],
        },
      };

      let emittedEvent: any;
      service.on('enriched_notification', (event) => {
        emittedEvent = event;
      });

      // Get the subscribe callback and call it
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        await subscribeCallback(mockNotification);
      }

      expect(checkpointerEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(emittedEvent).toEqual(mockToolCallNotification);
    });

    it('should handle checkpointer notification and emit multiple events', async () => {
      const mockMessageNotification: ICheckpointerMessageEnrichedNotification =
        {
          type: EnrichedNotificationEvent.CheckpointerMessage,
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: {
            content: 'Hello!',
            role: 'ai',
          },
        };

      const mockToolCallNotification: ICheckpointerToolCallEnrichedNotification =
        {
          type: EnrichedNotificationEvent.CheckpointerToolCall,
          graphId: mockGraphId,
          ownerId: mockOwnerId,
          nodeId: mockNodeId,
          threadId: mockThreadId,
          data: {
            name: 'get_weather',
            args: { city: 'SF' },
            id: 'call-123',
          },
        };

      checkpointerEventHandler.handle.mockResolvedValue([
        mockMessageNotification,
        mockToolCallNotification,
      ]);

      const mockNotification: ICheckpointerNotification = {
        type: NotificationEvent.Checkpointer,
        graphId: mockGraphId,
        nodeId: mockNodeId,
        threadId: mockThreadId,
        data: {
          action: 'putWrites',
          writes: [],
        },
      };

      const emittedEvents: any[] = [];
      service.on('enriched_notification', (event) => {
        emittedEvents.push(event);
      });

      // Get the subscribe callback and call it
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        await subscribeCallback(mockNotification);
      }

      expect(checkpointerEventHandler.handle).toHaveBeenCalledWith(
        mockNotification,
      );
      expect(emittedEvents).toHaveLength(2);
      expect(emittedEvents[0]).toEqual(mockMessageNotification);
      expect(emittedEvents[1]).toEqual(mockToolCallNotification);
    });

    it('should process multiple notifications', async () => {
      const mockEnrichedNotification: IGraphEnrichedNotification = {
        type: EnrichedNotificationEvent.Graph,
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        data: { state: 'compiled', schema: mockGraphSchema },
      };

      graphEventHandler.handle.mockResolvedValue([mockEnrichedNotification]);

      const mockNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { state: 'compiled', schema: mockGraphSchema },
      };

      const emittedEvents: any[] = [];
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
        data: { state: 'compiled', schema: mockGraphSchema },
      };

      const emittedEvents: any[] = [];
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

    it('should handle errors from event handler', async () => {
      const error = new Error('Processing error');
      graphEventHandler.handle.mockRejectedValue(error);

      const mockNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: mockGraphId,
        data: { state: 'compiled', schema: mockGraphSchema },
      };

      // Get the subscribe callback and call it
      const subscribeCallback =
        notificationsService.subscribe.mock.calls[0]?.[0];
      if (subscribeCallback) {
        await subscribeCallback(mockNotification);
      }

      expect(logger.error).toHaveBeenCalledWith(
        error,
        'Failed to handle notification',
        {
          graphId: mockGraphId,
          type: NotificationEvent.Graph,
        },
      );
    });
  });

  describe('subscribeEvents', () => {
    it('should allow subscribing to enriched notifications', () => {
      const callback = vi.fn();
      service.subscribeEvents(callback);

      // Emit a test event
      const testEvent: IGraphEnrichedNotification = {
        type: EnrichedNotificationEvent.Graph,
        graphId: mockGraphId,
        ownerId: mockOwnerId,
        data: { state: 'compiled', schema: mockGraphSchema },
      };

      service.emit('enriched_notification', testEvent);

      expect(callback).toHaveBeenCalledWith(testEvent);
    });
  });
});
