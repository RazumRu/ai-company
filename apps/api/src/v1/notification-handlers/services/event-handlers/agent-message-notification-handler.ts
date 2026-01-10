import { Injectable } from '@nestjs/common';
import { DefaultLogger, NotFoundException } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import { MessageTransformerService } from '../../../graphs/services/message-transformer.service';
import type { MessageTokenUsage } from '../../../litellm/litellm.types';
import { LitellmService } from '../../../litellm/services/litellm.service';
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

export interface IAgentMessageEnrichedNotification extends IEnrichedNotification<ThreadMessageDto> {
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
    private readonly litellmService: LitellmService,
    private readonly logger: DefaultLogger,
  ) {
    super();
  }

  async handle(
    event: IAgentMessageNotification,
  ): Promise<IAgentMessageEnrichedNotification[]> {
    const ownerId = await this.getGraphOwner(event.graphId);
    const out: IAgentMessageEnrichedNotification[] = [];

    const externalThreadKey = event.parentThreadId ?? event.threadId;

    // Find the internal thread by internalThreadId passed from the event
    const internalThread = await this.threadsDao.getOne({
      externalThreadId: externalThreadKey,
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

    for (const [i, messageDto] of messageDtos.entries()) {
      const originalMessage = event.data.messages[i];
      const tokenUsage =
        this.litellmService.extractMessageTokenUsageFromAdditionalKwargs(
          originalMessage?.additional_kwargs ?? undefined,
        );

      // Tool messages should already have token usage attached by graph-state.manager
      // If not, this indicates a configuration issue or missing model information
      if (!tokenUsage && originalMessage?.type === 'ToolMessage') {
        this.logger.warn(
          `Tool message without token usage - should have been computed in graph-state.manager`,
          {
            messageType: originalMessage.type,
            hasModel: !!originalMessage.additional_kwargs?.__model,
            threadId: event.threadId,
            nodeId: event.nodeId,
          },
        );
      }

      // Save message to database with correct internal thread ID
      const createdMessage = await this.messagesDao.create({
        threadId: internalThread.id,
        externalThreadId: event.threadId,
        nodeId: event.nodeId,
        message: messageDto,
        ...(tokenUsage ? { tokenUsage: tokenUsage as MessageTokenUsage } : {}),
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
