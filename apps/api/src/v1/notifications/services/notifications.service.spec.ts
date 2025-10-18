import EventEmitter from 'node:events';

import { HumanMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ICheckpointerNotification,
  IGraphNotification,
  NotificationEvent,
} from '../notifications.types';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockLogger: any;
  let _mockEmitter: EventEmitter;

  beforeEach(async () => {
    mockLogger = {
      debug: vi.fn(),
    };

    _mockEmitter = new EventEmitter();

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

    // Spy on the service's internal emitter (done within specific tests as needed)
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('emit', () => {
    it('should emit graph notification', () => {
      const graphNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: 'test-graph-123',
        nodeId: 'test-node-456',
        threadId: 'test-thread-789',
        data: {
          state: 'compiled',
          schema: {
            nodes: [],
            edges: [],
          },
        },
      };

      const emitSpy = vi.spyOn(service['emitter'], 'emit');

      service.emit(graphNotification);

      expect(emitSpy).toHaveBeenCalledWith('event', graphNotification);
    });

    it('should emit checkpointer notification with messages', () => {
      const checkpointerNotification: ICheckpointerNotification = {
        type: NotificationEvent.Checkpointer,
        graphId: 'test-graph-123',
        nodeId: 'test-node-456',
        threadId: 'test-thread-789',
        data: {
          messages: [new HumanMessage('Hello world')],
        },
      };

      const emitSpy = vi.spyOn(service['emitter'], 'emit');

      service.emit(checkpointerNotification);

      expect(emitSpy).toHaveBeenCalledWith('event', checkpointerNotification);
    });

    it('should emit checkpointer notification with empty messages', () => {
      const checkpointerNotification: ICheckpointerNotification = {
        type: NotificationEvent.Checkpointer,
        graphId: 'test-graph-123',
        nodeId: 'test-node-456',
        threadId: 'test-thread-789',
        data: {
          messages: [],
        },
      };

      const emitSpy = vi.spyOn(service['emitter'], 'emit');

      service.emit(checkpointerNotification);

      expect(emitSpy).toHaveBeenCalledWith('event', checkpointerNotification);
    });
  });

  describe('subscribe', () => {
    it('should register event listener', () => {
      const mockCallback = vi.fn();
      const onSpy = vi.spyOn(service['emitter'], 'on');

      service.subscribe(mockCallback);

      expect(onSpy).toHaveBeenCalledWith('event', mockCallback);
    });

    it('should call registered callback when event is emitted', async () => {
      const mockCallback = vi.fn().mockResolvedValue(undefined);
      const testNotification: IGraphNotification = {
        type: NotificationEvent.Graph,
        graphId: 'test-graph-123',
        data: {
          state: 'compiled',
          schema: {
            nodes: [],
            edges: [],
          },
        },
      };

      service.subscribe(mockCallback);
      service.emit(testNotification);

      // Wait for async callback
      await new Promise((resolve) => setImmediate(resolve));

      expect(mockCallback).toHaveBeenCalledWith(testNotification);
    });
  });
});
