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

    // Prepare all messages for batch insert
    const messagesToCreate = messageDtos.map((messageDto, i) => {
      const originalMessage = event.data.messages[i];
      const additionalKwargs = originalMessage?.additional_kwargs as
        | MessageAdditionalKwargs
        | undefined;

      // Extract request-level token usage (full RequestTokenUsage from LLM request).
      // Skip for subagent internal messages (__hideForLlm) — their token usage is
      // already captured by the parent tool result's requestTokenUsage (e.g. subagents_run_task).
      const isSubagentInternal = additionalKwargs?.__hideForLlm === true;
      const requestTokenUsage = isSubagentInternal
        ? undefined
        : (additionalKwargs?.__requestUsage as RequestTokenUsage | undefined);

      // Extract tool call names and IDs for AI messages with tool calls
      const toolCalls =
        messageDto.role === MessageRole.AI &&
        Array.isArray(messageDto.toolCalls) &&
        messageDto.toolCalls.length > 0
          ? messageDto.toolCalls
          : undefined;

      const toolCallNames = toolCalls
        ?.map((tc) => tc.name)
        .filter((name): name is string => typeof name === 'string');

      const toolCallIds = toolCalls
        ?.map((tc) => tc.id)
        .filter((id): id is string => typeof id === 'string');

      // Extract tool's own execution token usage (e.g. subagent aggregate tokens)
      const toolTokenUsage = additionalKwargs?.__toolTokenUsage as
        | RequestTokenUsage
        | undefined;

      return {
        threadId: internalThread.id,
        externalThreadId: event.threadId,
        nodeId: event.nodeId,
        message: messageDto,
        // Store requestTokenUsage if present (skipped for subagent internal messages above)
        ...(requestTokenUsage ? { requestTokenUsage } : {}),
        // Denormalize role, name, toolCallNames, and toolCallIds for query performance
        role: messageDto.role,
        name: 'name' in messageDto ? (messageDto.name as string) : undefined,
        ...(toolCallNames && toolCallNames.length > 0 ? { toolCallNames } : {}),
        ...(toolCallIds && toolCallIds.length > 0 ? { toolCallIds } : {}),
        answeredToolCallNames: Array.isArray(
          additionalKwargs?.__answeredToolCallNames,
        )
          ? (additionalKwargs.__answeredToolCallNames as string[])
          : undefined,
        // Denormalize additionalKwargs for statistics queries (avoids fetching full message JSONB)
        additionalKwargs: additionalKwargs as
          | Record<string, unknown>
          | undefined,
        // Tool's own execution cost (e.g. subagent aggregate tokens)
        ...(toolTokenUsage ? { toolTokenUsage } : {}),
      };
    });

    // Batch insert all messages in a single transaction
    const createdMessages =
      messagesToCreate.length > 0
        ? await this.messagesDao.createMany(messagesToCreate)
        : [];

    // Build notification events for each created message
    for (const createdMessage of createdMessages) {
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
