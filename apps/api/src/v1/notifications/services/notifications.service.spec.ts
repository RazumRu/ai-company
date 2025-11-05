import { HumanMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphStatus } from '../../graphs/graphs.types';
import { Notification } from '../notifications.types';
import {
  IAgentMessageNotification,
  IGraphNotification,
  NotificationEvent,
} from '../notifications.types';
import { NotificationsService } from './notifications.service';

// Mock BullMQ and IORedis
vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    add = vi.fn().mockResolvedValue({ id: 'test-job-id' });
    close = vi.fn().mockResolvedValue(undefined);
  },
  Worker: class MockWorker {
    close = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('ioredis', () => ({
  default: class MockIORedis {
    quit = vi.fn().mockResolvedValue(undefined);
  },
}));

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockLogger: Record<string, unknown>;

  beforeEach(async () => {
    mockLogger = {
      debug: vi.fn(),
      log: vi.fn(),
      error: vi.fn(),
    };

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
    it('should emit graph notification through queue', async () => {
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

      const queueAddSpy = vi.spyOn(service['queue'], 'add');

      await service.emit(graphNotification);

      expect(queueAddSpy).toHaveBeenCalledWith(
        'process-notification',
        graphNotification,
      );
    });

    it('should enqueue agent message notification through BullMQ', async () => {
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

      const queueAddSpy = vi.spyOn(service['queue'], 'add');

      await service.emit(agentMessageNotification);

      expect(queueAddSpy).toHaveBeenCalledWith(
        'process-notification',
        agentMessageNotification,
      );
    });

    it('should enqueue agent invoke notification through BullMQ', async () => {
      const agentInvokeNotification = {
        type: NotificationEvent.AgentInvoke,
        graphId: 'test-graph-123',
        nodeId: 'test-node-456',
        threadId: 'test-thread-789',
        parentThreadId: 'parent-thread-123',
        data: {
          messages: [new HumanMessage('Hello')],
        },
      };

      const queueAddSpy = vi.spyOn(service['queue'], 'add');

      await service.emit(agentInvokeNotification as Notification);

      expect(queueAddSpy).toHaveBeenCalledWith(
        'process-notification',
        agentInvokeNotification,
      );
    });

    it('should enqueue agent message notification with empty messages', async () => {
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

      const queueAddSpy = vi.spyOn(service['queue'], 'add');

      await service.emit(agentMessageNotification);

      expect(queueAddSpy).toHaveBeenCalledWith(
        'process-notification',
        agentMessageNotification,
      );
    });

    it('should handle BullMQ enqueue errors gracefully', async () => {
      const agentMessageNotification: IAgentMessageNotification = {
        type: NotificationEvent.AgentMessage,
        graphId: 'test-graph-123',
        nodeId: 'test-node-456',
        threadId: 'test-thread-789',
        parentThreadId: 'parent-thread-123',
        data: {
          messages: [new HumanMessage('Hello')],
        },
      };

      const queueError = new Error('BullMQ connection failed');
      const queueAddSpy = vi.spyOn(service['queue'], 'add');
      queueAddSpy.mockRejectedValue(queueError);

      await expect(service.emit(agentMessageNotification)).rejects.toThrow(
        'BullMQ connection failed',
      );
    });
  });

  describe('subscribe', () => {
    it('should register event listener', () => {
      const mockCallback = vi.fn();

      service.subscribe(mockCallback);

      // Verify the callback was added to subscribers array
      expect(service['subscribers']).toContain(mockCallback);
    });

    it('should call registered callback when event is emitted', async () => {
      const mockCallback = vi.fn().mockResolvedValue(undefined);
      const testNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: 'test-graph-123',
        data: {
          status: GraphStatus.Running,
          schema: {
            nodes: [],
            edges: [],
          },
        },
      };

      service.subscribe(mockCallback);

      // Simulate the job processing by calling the processJob method directly
      await service['processJob']({
        data: testNotification,
        id: 'test-job',
      } as unknown as any);

      expect(mockCallback).toHaveBeenCalledWith(testNotification);
    });
  });
});
