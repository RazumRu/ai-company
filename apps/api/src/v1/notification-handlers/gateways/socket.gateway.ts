import {
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  DefaultLogger,
  NotFoundException,
  UnauthorizedException,
  ValidationException,
} from '@packages/common';
import { AuthContextDataBuilder } from '@packages/http-server';
import { Server, Socket } from 'socket.io';

import { GraphDao } from '../../graphs/dao/graph.dao';
import {
  IEnrichedNotification,
  NotificationScope,
} from '../notification-handlers.types';
import { NotificationHandler } from '../services/notification-handler.service';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
})
export class SocketGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private ws!: Server;

  constructor(
    private readonly eventsHandler: NotificationHandler,
    private readonly authContextDataBuilder: AuthContextDataBuilder,
    private readonly graphDao: GraphDao,
    private readonly logger: DefaultLogger,
  ) {}

  public getUserRoomName(userId: string): string {
    return `user:${userId}`;
  }

  public getGraphRoomName(graphId: string): string {
    return `graph:${graphId}`;
  }

  private emitError(err: Error, client: Socket, disconnect = false): void {
    client.emit('server_error', { message: err.message });
    if (disconnect) client.disconnect(true);
  }

  afterInit() {
    // Subscribe to events handler for enriched notifications
    this.eventsHandler.subscribeEvents(
      (event: IEnrichedNotification<unknown>) => {
        const { graphId, ownerId, type, scope } = event;

        const graphRoom = this.getGraphRoomName(graphId);
        const userRoom = this.getUserRoomName(ownerId);

        // Send notifications based on scope array
        for (const scopeItem of scope) {
          switch (scopeItem) {
            case NotificationScope.Graph:
              this.broadcastToRoom(graphRoom, type, event);
              break;
            case NotificationScope.User:
              this.broadcastToRoom(userRoom, type, event);
              break;
          }
        }
      },
    );
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth.token;

      // Get auth data from the socket handshake for dev mode authentication
      const authData = client.handshake.auth as Record<string, string>;

      const contextData = await this.authContextDataBuilder.buildContextData(
        token,
        authData,
      );

      if (!contextData?.sub) {
        throw new UnauthorizedException();
      }

      const userId = contextData.sub;

      // Store user ID in socket data for later use
      client.data.userId = userId;

      // Automatically join user's personal room
      const userRoom = this.getUserRoomName(userId);
      await client.join(userRoom);
      client.emit('socket_connected');
    } catch (err) {
      this.logger.error(<Error>err, 'Socket connection error');
      this.emitError(<Error>err, client, true);
    }
  }

  public broadcast<T>(event: string, payload: T) {
    this.ws.emit(event, payload);
  }

  public broadcastToRoom<T>(room: string, event: string, payload: T) {
    this.ws.to(room).emit(event, payload);
  }

  @SubscribeMessage('subscribe_graph')
  async handleSubscribeGraph(
    client: Socket,
    payload: { graphId: string },
  ): Promise<void> {
    try {
      const userId = client.data.userId;

      if (!userId) {
        throw new UnauthorizedException();
      }

      if (!payload?.graphId) {
        throw new ValidationException(
          'VALIDATION_ERROR',
          'Graph ID is required',
        );
      }

      // Check if graph exists and user is the owner
      const graph = await this.graphDao.getOne({
        id: payload.graphId,
        createdBy: userId,
      });

      if (!graph) {
        throw new NotFoundException('GRAPH_NOT_FOUND');
      }

      // Join graph room
      const graphRoom = this.getGraphRoomName(payload.graphId);
      await client.join(graphRoom);
    } catch (err) {
      this.logger.error(err as Error, 'Subscribe graph error');
      this.emitError(err as Error, client);
    }
  }

  @SubscribeMessage('unsubscribe_graph')
  async handleUnsubscribeGraph(
    client: Socket,
    payload: { graphId: string },
  ): Promise<void> {
    try {
      const graphRoom = this.getGraphRoomName(payload.graphId);
      await client.leave(graphRoom);
    } catch (err) {
      this.logger.error(err as Error, 'Unsubscribe graph error');
      this.emitError(err as Error, client);
    }
  }
}
