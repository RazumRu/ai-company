import { Test, TestingModule } from '@nestjs/testing';
import { DefaultLogger } from '@packages/common';
import { AuthContextDataBuilder } from '@packages/http-server';
import { Socket } from 'socket.io';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDeep, MockProxy } from 'vitest-mock-extended';

import { GraphDao } from '../../graphs/dao/graph.dao';
import { IEnrichedNotification } from '../notification-handlers.types';
import { NotificationHandler } from '../services/notification-handler.service';
import { SocketGateway } from './socket.gateway';

describe('SocketGateway', () => {
  let gateway: SocketGateway;
  let eventsHandler: MockProxy<NotificationHandler>;
  let authContextDataBuilder: MockProxy<AuthContextDataBuilder>;
  let graphDao: MockProxy<GraphDao>;
  let logger: MockProxy<DefaultLogger>;

  const mockUserId = 'user-123';
  const mockGraphId = 'graph-456';
  const mockToken = 'valid-token';

  beforeEach(async () => {
    eventsHandler = mockDeep<NotificationHandler>();
    authContextDataBuilder = mockDeep<AuthContextDataBuilder>();
    graphDao = mockDeep<GraphDao>();
    logger = mockDeep<DefaultLogger>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SocketGateway,
        {
          provide: NotificationHandler,
          useValue: eventsHandler,
        },
        {
          provide: AuthContextDataBuilder,
          useValue: authContextDataBuilder,
        },
        {
          provide: GraphDao,
          useValue: graphDao,
        },
        {
          provide: DefaultLogger,
          useValue: logger,
        },
      ],
    }).compile();

    gateway = module.get<SocketGateway>(SocketGateway);
  });

  describe('afterInit', () => {
    it('should initialize the gateway and subscribe to events handler', () => {
      gateway.afterInit();

      expect(eventsHandler.subscribeEvents).toHaveBeenCalledWith(
        expect.any(Function),
      );
    });

    it('should broadcast enriched notifications to graph and user rooms', () => {
      // Mock the WebSocket server
      const mockServer = {
        emit: vi.fn(),
        to: vi.fn().mockReturnThis(),
      };
      (gateway as any).ws = mockServer;

      // First initialize the gateway to set up the subscription
      gateway.afterInit();

      const mockEnrichedNotification: IEnrichedNotification<any> = {
        type: 'graph.update' as any,
        graphId: mockGraphId,
        ownerId: mockUserId,
        data: { state: 'compiled' },
      };

      // Get the event handler callback and call it
      const eventHandlerCallback =
        eventsHandler.subscribeEvents.mock.calls[0]![0];
      eventHandlerCallback(mockEnrichedNotification);

      // Verify that the gateway broadcasts to both rooms
      expect(mockServer.to).toHaveBeenCalledWith(`graph:${mockGraphId}`);
      expect(mockServer.to).toHaveBeenCalledWith(`user:${mockUserId}`);
    });
  });

  describe('handleConnection', () => {
    let mockClient: Socket;

    beforeEach(() => {
      mockClient = {
        handshake: {
          auth: {
            token: mockToken,
            'x-dev-jwt-sub': mockUserId,
          },
        },
        id: 'socket-123',
        data: {},
        emit: vi.fn(),
        disconnect: vi.fn(),
        join: vi.fn(),
      } as unknown as Socket;
    });

    it('should authenticate and connect a client successfully', async () => {
      authContextDataBuilder.buildContextData.mockResolvedValue({
        sub: mockUserId,
      });

      await gateway.handleConnection(mockClient);

      expect(authContextDataBuilder.buildContextData).toHaveBeenCalledWith(
        mockToken,
        mockClient.handshake.auth,
      );
      expect(mockClient.data.userId).toBe(mockUserId);
      expect(mockClient.join).toHaveBeenCalledWith(`user:${mockUserId}`);
      expect(logger.debug).toHaveBeenCalledWith(
        'Client connected',
        expect.objectContaining({
          socketId: mockClient.id,
          userId: mockUserId,
          userRoom: `user:${mockUserId}`,
        }),
      );
    });

    it('should reject connection without token', async () => {
      mockClient.handshake.auth = {};

      await gateway.handleConnection(mockClient);

      expect(mockClient.emit).toHaveBeenCalledWith('server_error', {
        message: 'Unauthorized',
      });
      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('should reject connection with invalid token', async () => {
      authContextDataBuilder.buildContextData.mockResolvedValue({});

      await gateway.handleConnection(mockClient);

      expect(authContextDataBuilder.buildContextData).toHaveBeenCalledWith(
        mockToken,
        mockClient.handshake.auth,
      );
      expect(mockClient.emit).toHaveBeenCalledWith('server_error', {
        message: 'Unauthorized',
      });
      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });

    it('should handle authentication errors', async () => {
      const error = new Error('Token verification failed');
      authContextDataBuilder.buildContextData.mockRejectedValue(error);

      await gateway.handleConnection(mockClient);

      expect(authContextDataBuilder.buildContextData).toHaveBeenCalledWith(
        mockToken,
        mockClient.handshake.auth,
      );
      expect(logger.error).toHaveBeenCalled();
      expect(mockClient.emit).toHaveBeenCalledWith('server_error', {
        message: error.message,
      });
      expect(mockClient.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('broadcast methods', () => {
    let mockServer: any;

    beforeEach(() => {
      mockServer = {
        emit: vi.fn(),
        to: vi.fn().mockReturnThis(),
      };
      (gateway as any).ws = mockServer;
    });

    it('should broadcast to all clients', () => {
      const event = 'test_event';
      const payload = { data: 'test' };

      gateway.broadcast(event, payload);

      expect(mockServer.emit).toHaveBeenCalledWith(event, payload);
    });

    it('should broadcast to specific room', () => {
      const event = 'test_event';
      const payload = { data: 'test' };
      const room = 'custom-room';

      gateway.broadcastToRoom(room, event, payload);

      expect(mockServer.to).toHaveBeenCalledWith(room);
      expect(mockServer.emit).toHaveBeenCalledWith(event, payload);
    });
  });
});
