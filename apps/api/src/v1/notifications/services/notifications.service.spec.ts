import { HumanMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, MockProxy } from 'vitest-mock-extended';

import { GraphStatus } from '../../graphs/graphs.types';
import {
  IAgentMessageNotification,
  IGraphNotification,
  NotificationEvent,
} from '../notifications.types';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockLogger: MockProxy<DefaultLogger>;

  beforeEach(async () => {
    mockLogger = mockDeep<DefaultLogger>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: DefaultLogger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('emit', () => {
    it('should dispatch graph notification to subscribers synchronously', async () => {
      const graphNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: 'test-graph-123',
        nodeId: 'test-node-456',
        threadId: 'test-thread-789',
        data: {
          status: GraphStatus.Running,
          schema: {
            nodes: [],
            edges: [],
          },
        },
      };

      const subscriber = vi.fn().mockResolvedValue(undefined);
      service.subscribe(subscriber);

      await service.emit(graphNotification);

      expect(subscriber).toHaveBeenCalledWith(graphNotification);
    });

    it('should dispatch agent message notification with BaseMessage instances', async () => {
      const agentMessageNotification: IAgentMessageNotification = {
        type: NotificationEvent.AgentMessage,
        graphId: 'test-graph-123',
        nodeId: 'test-node-456',
        threadId: 'test-thread-789',
        parentThreadId: 'parent-thread-123',
        data: {
          messages: [new HumanMessage('Hello world')],
        },
      };

      const subscriber = vi.fn().mockResolvedValue(undefined);
      service.subscribe(subscriber);

      await service.emit(agentMessageNotification);

      expect(subscriber).toHaveBeenCalledWith(agentMessageNotification);
      // Verify the actual BaseMessage instance flows through unchanged
      const receivedNotification = subscriber.mock
        .calls[0]![0] as IAgentMessageNotification;
      expect(receivedNotification.data.messages[0]).toBeInstanceOf(
        HumanMessage,
      );
    });

    it('should dispatch to multiple subscribers', async () => {
      const notification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: 'test-graph-123',
        data: {
          status: GraphStatus.Running,
        },
      };

      const subscriber1 = vi.fn().mockResolvedValue(undefined);
      const subscriber2 = vi.fn().mockResolvedValue(undefined);
      service.subscribe(subscriber1);
      service.subscribe(subscriber2);

      await service.emit(notification);

      expect(subscriber1).toHaveBeenCalledWith(notification);
      expect(subscriber2).toHaveBeenCalledWith(notification);
    });

    it('should not throw when a subscriber fails, and other subscribers still receive the notification', async () => {
      const notification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: 'test-graph-123',
        data: {
          status: GraphStatus.Running,
        },
      };

      const failingSubscriber = vi
        .fn()
        .mockRejectedValue(new Error('Subscriber error'));
      const successfulSubscriber = vi.fn().mockResolvedValue(undefined);
      service.subscribe(failingSubscriber);
      service.subscribe(successfulSubscriber);

      await service.emit(notification);

      expect(failingSubscriber).toHaveBeenCalledWith(notification);
      expect(successfulSubscriber).toHaveBeenCalledWith(notification);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should not call subscribers and should log error when payload is invalid', async () => {
      const invalidPayload = {
        type: NotificationEvent.Graph,
        // missing required graphId
        data: { status: GraphStatus.Running },
      } as unknown as IGraphNotification;

      const subscriber = vi.fn().mockResolvedValue(undefined);
      service.subscribe(subscriber);

      await service.emit(invalidPayload);

      expect(subscriber).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledOnce();
    });

    it('should not throw when payload is invalid', async () => {
      const invalidPayload = {
        type: NotificationEvent.Graph,
        data: { status: GraphStatus.Running },
      } as unknown as IGraphNotification;

      await expect(service.emit(invalidPayload)).resolves.toBeUndefined();
    });

    it('should include eventType, eventKeys, envelope, and issues in error log metadata for invalid payload', async () => {
      const invalidPayload = {
        type: NotificationEvent.Graph,
        data: { status: GraphStatus.Running },
      } as unknown as IGraphNotification;

      await service.emit(invalidPayload);

      expect(mockLogger.error).toHaveBeenCalledOnce();
      const [, , meta] = mockLogger.error.mock.calls[0] as [
        unknown,
        string,
        Record<string, unknown>,
      ];
      expect(meta).toHaveProperty('eventType', NotificationEvent.Graph);
      expect(meta).toHaveProperty('eventKeys');
      expect(Array.isArray(meta.eventKeys)).toBe(true);
      expect(meta).toHaveProperty('envelope');
      expect(typeof meta.envelope).toBe('object');
      expect(meta).toHaveProperty('issues');
      expect(Array.isArray(meta.issues)).toBe(true);
      // Must NOT include snippet or the data field
      expect(meta).not.toHaveProperty('snippet');
      expect(meta).not.toHaveProperty('data');
    });

    it('should NOT include the `data` field in the error log metadata for an invalid payload containing sensitive content', async () => {
      const secretValue = 'supersecret-xyz';
      const invalidPayload = {
        type: NotificationEvent.AgentMessage,
        // missing required graphId — this makes the payload invalid
        data: {
          messages: [new HumanMessage('user input')],
          secretField: secretValue,
        },
      } as unknown as IAgentMessageNotification;

      await service.emit(invalidPayload);

      expect(mockLogger.error).toHaveBeenCalledOnce();
      const [, , meta] = mockLogger.error.mock.calls[0] as [
        unknown,
        string,
        Record<string, unknown>,
      ];
      // The sensitive value must not appear anywhere in the logged metadata
      const serializedMeta = JSON.stringify(meta);
      expect(serializedMeta).not.toContain(secretValue);
      // The `data` key itself must not be present
      expect(meta).not.toHaveProperty('data');
    });

    it('should handle empty messages array', async () => {
      const agentMessageNotification: IAgentMessageNotification = {
        type: NotificationEvent.AgentMessage,
        graphId: 'test-graph-123',
        nodeId: 'test-node-456',
        threadId: 'test-thread-789',
        parentThreadId: 'parent-thread-123',
        data: {
          messages: [],
        },
      };

      const subscriber = vi.fn().mockResolvedValue(undefined);
      service.subscribe(subscriber);

      await service.emit(agentMessageNotification);

      expect(subscriber).toHaveBeenCalledWith(agentMessageNotification);
    });
  });

  describe('subscribe', () => {
    it('should register event listener', () => {
      const mockCallback = vi.fn();

      service.subscribe(mockCallback);

      expect(service['subscribers']).toContain(mockCallback);
    });
  });
});
