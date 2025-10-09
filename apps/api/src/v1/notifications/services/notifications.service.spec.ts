import EventEmitter from 'node:events';

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
  let mockEmitter: EventEmitter;

  beforeEach(async () => {
    mockLogger = {
      debug: vi.fn(),
    };

    mockEmitter = new EventEmitter();

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
    
    // Spy on the service's internal emitter
    const emitSpy = vi.spyOn(service['emitter'], 'emit');
    const onSpy = vi.spyOn(service['emitter'], 'on');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('emit', () => {
    it('should emit graph notification and log debug message', () => {
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
            metadata: {
              graphId: 'test-graph-123',
              version: '1.0.0',
            },
          },
        },
      };

      const emitSpy = vi.spyOn(service['emitter'], 'emit');

      service.emit(graphNotification);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'notifications.emit',
        graphNotification,
      );
      expect(emitSpy).toHaveBeenCalledWith('event', graphNotification);
    });

    it('should emit checkpointer notification with put action', () => {
      const checkpointerNotification: ICheckpointerNotification = {
        type: NotificationEvent.Checkpointer,
        graphId: 'test-graph-123',
        nodeId: 'test-node-456',
        threadId: 'test-thread-789',
        data: {
          action: 'put',
          checkpoint: {
            id: 'checkpoint-123',
            ts: '2024-01-01T00:00:00Z',
            v: 1,
            channel_values: {},
            channel_versions: {},
            versions_seen: {},
          },
          metadata: {
            source: 'input',
            step: 1,
            parents: {},
          },
        },
      };

      const emitSpy = vi.spyOn(service['emitter'], 'emit');

      service.emit(checkpointerNotification);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'notifications.emit',
        checkpointerNotification,
      );
      expect(emitSpy).toHaveBeenCalledWith('event', checkpointerNotification);
    });

    it('should emit checkpointer notification with putWrites action', () => {
      const checkpointerNotification: ICheckpointerNotification = {
        type: NotificationEvent.Checkpointer,
        graphId: 'test-graph-123',
        nodeId: 'test-node-456',
        threadId: 'test-thread-789',
        data: {
          action: 'putWrites',
          writes: [
            {
              channel: 'messages',
              value: { content: 'Hello world', type: 'human' },
            },
            {
              channel: 'tools',
              value: { name: 'search', args: { query: 'test' } },
            },
          ],
        },
      };

      const emitSpy = vi.spyOn(service['emitter'], 'emit');

      service.emit(checkpointerNotification);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'notifications.emit',
        checkpointerNotification,
      );
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
            metadata: {
              graphId: 'test-graph-123',
              version: '1.0.0',
            },
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
