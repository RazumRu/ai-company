import { Injectable } from '@nestjs/common';
import { DefaultLogger, NotFoundException } from '@packages/common';

import type { MessageAdditionalKwargs } from '../../../agents/agents.types';
import { GraphDao } from '../../../graphs/dao/graph.dao';
import { MessageRole } from '../../../graphs/graphs.types';
import { MessageTransformerService } from '../../../graphs/services/message-transformer.service';
import type { RequestTokenUsage } from '../../../litellm/litellm.types';
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
      const additionalKwargs = originalMessage?.additional_kwargs as
        | MessageAdditionalKwargs
        | undefined;

      // Extract request-level token usage (full RequestTokenUsage from LLM request)
      const requestTokenUsage = additionalKwargs?.__requestUsage as
        | RequestTokenUsage
        | undefined;

      // Extract tool call names for AI messages with tool calls
      const toolCallNames =
        messageDto.role === MessageRole.AI &&
        Array.isArray(messageDto.toolCalls)
          ? messageDto.toolCalls
              .map((tc) => tc.name)
              .filter((name): name is string => typeof name === 'string')
          : undefined;

      // Save message to database with correct internal thread ID
      const createdMessage = await this.messagesDao.create({
        threadId: internalThread.id,
        externalThreadId: event.threadId,
        nodeId: event.nodeId,
        message: messageDto,
        // Store requestTokenUsage if it exists (no fallback, no filtering)
        ...(requestTokenUsage ? { requestTokenUsage } : {}),
        // Denormalize role, name, and toolCallNames for query performance
        role: messageDto.role,
        name: 'name' in messageDto ? (messageDto.name as string) : undefined,
        ...(toolCallNames && toolCallNames.length > 0 ? { toolCallNames } : {}),
        answeredToolCallNames: additionalKwargs?.__answeredToolCallNames,
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
