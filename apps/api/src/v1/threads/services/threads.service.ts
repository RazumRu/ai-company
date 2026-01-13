import { Injectable } from '@nestjs/common';
import { DefaultLogger, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import Decimal from 'decimal.js';

import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import { CheckpointStateService } from '../../agents/services/checkpoint-state.service';
import { MessageRole, NodeKind } from '../../graphs/graphs.types';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import { GraphsService } from '../../graphs/services/graphs.service';
import type { RequestTokenUsage } from '../../litellm/litellm.types';
import { LitellmService } from '../../litellm/services/litellm.service';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { MessagesDao } from '../dao/messages.dao';
import { ThreadsDao } from '../dao/threads.dao';
import {
  GetMessagesQueryDto,
  GetThreadsQueryDto,
  ThreadDto,
  ThreadMessageDto,
  ThreadUsageStatisticsDto,
  UsageStatisticsAggregate,
} from '../dto/threads.dto';
import { MessageEntity } from '../entity/message.entity';
import { ThreadEntity } from '../entity/thread.entity';
import { ThreadStatus } from '../threads.types';

@Injectable()
export class ThreadsService {
  constructor(
    private readonly threadDao: ThreadsDao,
    private readonly messagesDao: MessagesDao,
    private readonly authContext: AuthContextService,
    private readonly notificationsService: NotificationsService,
    private readonly graphsService: GraphsService,
    private readonly graphRegistry: GraphRegistry,
    private readonly logger: DefaultLogger,
    private readonly checkpointStateService: CheckpointStateService,
    private readonly litellmService: LitellmService,
  ) {}

  async getThreads(query: GetThreadsQueryDto): Promise<ThreadDto[]> {
    const userId = this.authContext.checkSub();

    const threads = await this.threadDao.getAll({
      createdBy: userId,
      ...query,
      order: { updatedAt: 'DESC' },
    });

    return await this.prepareThreadsResponse(threads);
  }

  async getThreadById(threadId: string): Promise<ThreadDto> {
    const userId = this.authContext.checkSub();

    const thread = await this.threadDao.getOne({
      id: threadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    return (await this.prepareThreadsResponse([thread]))[0]!;
  }

  async getThreadByExternalId(externalThreadId: string): Promise<ThreadDto> {
    const userId = this.authContext.checkSub();

    const thread = await this.threadDao.getOne({
      externalThreadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    return (await this.prepareThreadsResponse([thread]))[0]!;
  }

  async getThreadMessages(
    threadId: string,
    query?: GetMessagesQueryDto,
  ): Promise<ThreadMessageDto[]> {
    const userId = this.authContext.checkSub();

    // First verify the thread exists and belongs to the user
    const thread = await this.threadDao.getOne({
      id: threadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    const messages = await this.messagesDao.getAll({
      threadId,
      ...(query || {}),
      order: { createdAt: 'DESC' },
    });

    return messages.map((msg) => this.prepareMessageResponse(msg));
  }

  async deleteThread(threadId: string): Promise<void> {
    const userId = this.authContext.checkSub();

    // First verify the thread exists and belongs to the user
    const thread = await this.threadDao.getOne({
      id: threadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    // Delete all messages associated with this thread first
    await this.messagesDao.delete({ threadId });

    // Emit thread delete notification before removing the thread record
    await this.notificationsService.emit({
      type: NotificationEvent.ThreadDelete,
      graphId: thread.graphId,
      threadId: thread.externalThreadId,
      internalThreadId: thread.id,
      data: thread,
    });

    // Then delete the thread itself
    await this.threadDao.deleteById(threadId);
  }

  async stopThread(threadId: string): Promise<ThreadDto> {
    const userId = this.authContext.checkSub();

    const thread = await this.threadDao.getOne({
      id: threadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    if (thread.status !== ThreadStatus.Running) {
      return (await this.prepareThreadsResponse([thread]))[0]!;
    }

    // Best effort: stop execution in the running graph (if present in registry)
    try {
      await this.graphsService.stopThreadExecution(
        thread.graphId,
        thread.externalThreadId,
        'Graph execution was stopped',
      );
    } catch {
      // best effort
    }
    // Do not emit ThreadUpdate here; GraphStateManager will emit ThreadUpdate with Stopped
    // when the agent run terminates due to abort.
    return (await this.prepareThreadsResponse([thread]))[0]!;
  }

  async stopThreadByExternalId(externalThreadId: string): Promise<ThreadDto> {
    const userId = this.authContext.checkSub();

    const thread = await this.threadDao.getOne({
      externalThreadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    return this.stopThread(thread.id);
  }

  public async prepareThreadsResponse(
    entities: ThreadEntity[],
  ): Promise<ThreadDto[]> {
    // Token usage is fetched separately via GET /threads/:threadId/usage-statistics
    return entities.map((entity) => {
      const { deletedAt: _deletedAt, ...entityWithoutExcludedFields } = entity;
      return {
        ...entityWithoutExcludedFields,
        createdAt: new Date(entity.createdAt).toISOString(),
        updatedAt: new Date(entity.updatedAt).toISOString(),
        metadata: entity.metadata || {},
      };
    });
  }

  public async prepareThreadResponse(entity: ThreadEntity): Promise<ThreadDto> {
    return (await this.prepareThreadsResponse([entity]))[0]!;
  }

  public prepareMessageResponse(entity: MessageEntity): ThreadMessageDto {
    // Extract message-level token usage from kwargs (for this specific message)
    const additionalKwargs = entity.message.additionalKwargs as
      | Record<string, unknown>
      | undefined;
    const tokenUsage =
      this.litellmService.extractMessageTokenUsageFromAdditionalKwargs(
        additionalKwargs,
      );

    return {
      ...entity,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
      tokenUsage,
      requestTokenUsage: entity.requestTokenUsage ?? null,
    };
  }

  async getThreadUsageStatistics(
    threadId: string,
  ): Promise<ThreadUsageStatisticsDto> {
    const userId = this.authContext.checkSub();

    // First verify the thread exists and belongs to the user
    const thread = await this.threadDao.getOne({
      id: threadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    let totalUsage: RequestTokenUsage = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      totalPrice: 0,
      currentContext: 0,
    };
    let byNodeUsage = new Map<string, RequestTokenUsage>();
    const byToolUsage = new Map<
      string,
      {
        totalTokens: number;
        totalPrice: number;
        callCount: number;
      }
    >();

    const toolsAggregate: UsageStatisticsAggregate = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestCount: 0,
    };

    const messagesAggregate: UsageStatisticsAggregate = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestCount: 0,
    };

    const accumulate = (
      a: RequestTokenUsage,
      b: RequestTokenUsage,
    ): RequestTokenUsage => ({
      inputTokens: a.inputTokens + b.inputTokens,
      cachedInputTokens:
        (a.cachedInputTokens || 0) + (b.cachedInputTokens || 0),
      outputTokens: a.outputTokens + b.outputTokens,
      reasoningTokens: (a.reasoningTokens || 0) + (b.reasoningTokens || 0),
      totalTokens: a.totalTokens + b.totalTokens,
      totalPrice: (a.totalPrice || 0) + (b.totalPrice || 0),
      currentContext: (a.currentContext || 0) + (b.currentContext || 0),
    });

    // Priority 1: Try to get usage from local state (if agent is in memory)
    const agentNodes = this.graphRegistry.getNodesByType<SimpleAgent>(
      thread.graphId,
      NodeKind.SimpleAgent,
    );

    for (const agent of agentNodes) {
      const instance = agent.instance;
      const localUsage = instance.getThreadTokenUsage(thread.externalThreadId);
      if (localUsage) {
        totalUsage = accumulate(totalUsage, localUsage);
        byNodeUsage.set(agent.id, localUsage);
      }
    }

    // Priority 2: Fallback to checkpoint (if agent not in memory)
    if (totalUsage.totalTokens === 0) {
      const threadUsage = await this.checkpointStateService.getThreadTokenUsage(
        thread.externalThreadId,
      );

      if (threadUsage) {
        totalUsage = threadUsage;

        if (threadUsage.byNode) {
          byNodeUsage = new Map(Object.entries(threadUsage.byNode));
        }
      }
    }

    if (totalUsage.totalTokens === 0) {
      throw new NotFoundException('THREAD_USAGE_STATISTICS_NOT_FOUND');
    }

    // Format usage statistics from stored token usage data
    // We need to get messages to calculate byTool and aggregates
    const messages = await this.messagesDao.getAll({
      externalThreadId: thread.externalThreadId,
      order: { createdAt: 'ASC' },
      projection: [
        'id',
        'nodeId',
        'role',
        'name',
        'requestTokenUsage',
        'toolCallNames',
        'answeredToolCallNames',
      ],
    });

    // Use Decimal.js for price aggregation to avoid floating-point errors
    let toolsPriceDecimal = new Decimal(0);
    let messagesPriceDecimal = new Decimal(0);
    let totalRequests = 0;

    for (const [index, messageEntity] of messages.entries()) {
      const requestUsage = messageEntity.requestTokenUsage;
      const isToolAnswerMessage =
        messageEntity.role === MessageRole.AI &&
        Array.isArray(messageEntity.answeredToolCallNames) &&
        messageEntity.answeredToolCallNames.length > 0;
      const isToolMessage =
        messageEntity.role === MessageRole.Tool ||
        messageEntity.role === MessageRole.ToolShell;
      const isRealLlmRequest =
        (isToolAnswerMessage && requestUsage) ||
        (!isToolAnswerMessage && !isToolMessage);

      if (requestUsage) {
        if (isRealLlmRequest) {
          totalRequests++;
        }

        if (isToolAnswerMessage || isToolMessage) {
          toolsPriceDecimal = toolsPriceDecimal.plus(
            requestUsage.totalPrice || 0,
          );

          toolsAggregate.inputTokens += requestUsage.inputTokens;
          toolsAggregate.outputTokens += requestUsage.outputTokens;
          toolsAggregate.totalTokens += requestUsage.totalTokens;

          if (isRealLlmRequest) {
            toolsAggregate.requestCount++;
          }

          let answeredToolCallNames = messageEntity.answeredToolCallNames;
          if (!answeredToolCallNames && isToolMessage && messageEntity.name) {
            answeredToolCallNames = [messageEntity.name];
          }

          for (const toolName of answeredToolCallNames || []) {
            const current = byToolUsage.get(toolName);
            byToolUsage.set(toolName, {
              totalTokens:
                (current?.totalTokens || 0) + requestUsage.totalTokens,
              totalPrice:
                (current?.totalPrice || 0) + (requestUsage.totalPrice || 0),
              callCount: (current?.callCount || 0) + (isRealLlmRequest ? 1 : 0),
            });
          }
        } else {
          messagesPriceDecimal = messagesPriceDecimal.plus(
            requestUsage?.totalPrice || 0,
          );

          messagesAggregate.inputTokens += requestUsage.inputTokens;
          messagesAggregate.outputTokens += requestUsage.outputTokens;
          messagesAggregate.totalTokens += requestUsage.totalTokens;
          if (isRealLlmRequest) {
            messagesAggregate.requestCount++;
          }
        }
      }
    }

    // Finalize price aggregations
    if (!toolsPriceDecimal.isZero()) {
      toolsAggregate.totalPrice = toolsPriceDecimal.toNumber();
    }
    if (!messagesPriceDecimal.isZero()) {
      messagesAggregate.totalPrice = messagesPriceDecimal.toNumber();
    }

    return {
      total: totalUsage,
      requests: totalRequests,
      byNode: Object.fromEntries(byNodeUsage),
      byTool: Array.from(byToolUsage.entries()).map(([toolName, usage]) => ({
        toolName,
        ...usage,
      })),
      toolsAggregate,
      messagesAggregate,
    };
  }
}
