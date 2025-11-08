import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { MessageTransformerService } from '../../../graphs/services/message-transformer.service';
import {
  IAgentMessageNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { MessagesDao } from '../../../threads/dao/messages.dao';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import {
  ThreadMessageDto,
  ThreadMessageSchema,
} from '../../../threads/dto/threads.dto';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IAgentMessageEnrichedNotification
  extends IEnrichedNotification<ThreadMessageDto> {
  type: EnrichedNotificationEvent.AgentMessage;
  nodeId: string;
  threadId: string;
  internalThreadId: string;
}

@Injectable()
export class AgentMessageNotificationHandler extends BaseNotificationHandler<IAgentMessageEnrichedNotification> {
  readonly pattern = NotificationEvent.AgentMessage;
  private readonly graphOwnerCache = new Map<string, string>();

  constructor(
    private readonly graphDao: GraphDao,
    private readonly messageTransformer: MessageTransformerService,
    private readonly messagesDao: MessagesDao,
    private readonly threadsDao: ThreadsDao,
  ) {
    super();
  }

  async handle(
    event: IAgentMessageNotification,
  ): Promise<IAgentMessageEnrichedNotification[]> {
    const ownerId = await this.getGraphOwner(event.graphId);
    const out: IAgentMessageEnrichedNotification[] = [];

    // Find the internal thread by internalThreadId passed from the event
    const internalThread = await this.threadsDao.getOne({
      externalThreadId: event.parentThreadId,
    });

    if (!internalThread) {
      // Internal thread not found, skip message storage
      // This shouldn't happen if agent-invoke-notification-handler works correctly
      return out;
    }

    // Transform BaseMessage array
    const messageDtos = this.messageTransformer.transformMessagesToDto(
      event.data.messages,
    );

    for (const messageDto of messageDtos) {
      // Save message to database with correct internal thread ID
      const createdMessage = await this.messagesDao.create({
        threadId: internalThread.id,
        externalThreadId: event.threadId,
        nodeId: event.nodeId,
        message: messageDto,
      });

      out.push({
        type: EnrichedNotificationEvent.AgentMessage,
        graphId: event.graphId,
        ownerId,
        nodeId: event.nodeId,
        threadId: event.threadId,
        internalThreadId: internalThread.id,
        scope: [NotificationScope.Graph],
        data: ThreadMessageSchema.parse({
          ...createdMessage,
          createdAt: new Date(createdMessage.createdAt).toISOString(),
          updatedAt: new Date(createdMessage.updatedAt).toISOString(),
        }),
      });
    }

    return out;
  }

  private async getGraphOwner(graphId: string): Promise<string> {
    if (this.graphOwnerCache.has(graphId)) {
      return this.graphOwnerCache.get(graphId)!;
    }
    const graph = await this.graphDao.getOne({ id: graphId });
    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }
    this.graphOwnerCache.set(graphId, graph.createdBy);
    return graph.createdBy;
  }
}
