import { Injectable } from '@nestjs/common';
import { DefaultLogger, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';

import type { MessageAdditionalKwargs } from '../../agents/agents.types';
import { ThreadTokenUsageCacheService } from '../../cache/services/thread-token-usage-cache.service';
import { GraphsService } from '../../graphs/services/graphs.service';
import type { TokenUsage } from '../../litellm/litellm.types';
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
  UsageStatisticsByTool,
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
    private readonly logger: DefaultLogger,
    private readonly threadTokenUsageCacheService: ThreadTokenUsageCacheService,
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

    return messages.map(this.prepareMessageResponse);
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

    // Clean up Redis cache
    await this.threadTokenUsageCacheService.deleteThreadTokenUsage(
      thread.externalThreadId,
    );

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
    // No longer include tokenUsage in the default thread response
    // Use GET /threads/:threadId/usage-statistics instead
    return entities.map((entity) => {
      const {
        deletedAt: _deletedAt,
        tokenUsage: _tokenUsage,
        ...entityWithoutExcludedFields
      } = entity;
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

  private async getThreadsTokenUsage(
    entities: ThreadEntity[],
  ): Promise<
    Map<string, (TokenUsage & { byNode?: Record<string, TokenUsage> }) | null>
  > {
    const out = new Map<
      string,
      (TokenUsage & { byNode?: Record<string, TokenUsage> }) | null
    >();

    const runningThreads = entities.filter(
      (t) => t.status === ThreadStatus.Running,
    );

    const nonRunningThreads = entities.filter(
      (t) => t.status !== ThreadStatus.Running,
    );

    // Handle running threads: batch read from Redis (no syncing here)
    if (runningThreads.length > 0) {
      const externalThreadIds = runningThreads.map((t) => t.externalThreadId);
      const redisResults =
        await this.threadTokenUsageCacheService.getMultipleThreadTokenUsage(
          externalThreadIds,
        );

      for (const thread of runningThreads) {
        const usage = redisResults.get(thread.externalThreadId) ?? null;
        out.set(thread.id, usage);
      }
    }

    // Handle non-running threads: read from DB
    for (const thread of nonRunningThreads) {
      out.set(thread.id, thread.tokenUsage ?? null);
    }

    return out;
  }

  public prepareMessageResponse(entity: MessageEntity): ThreadMessageDto {
    // Extract requestTokenUsage from message.additionalKwargs.__requestUsage
    const additionalKwargs = entity.message.additionalKwargs as
      | MessageAdditionalKwargs
      | undefined;
    const requestUsage = additionalKwargs?.__requestUsage;

    const requestTokenUsage =
      requestUsage && typeof requestUsage === 'object'
        ? {
            inputTokens:
              typeof requestUsage.inputTokens === 'number'
                ? requestUsage.inputTokens
                : 0,
            outputTokens:
              typeof requestUsage.outputTokens === 'number'
                ? requestUsage.outputTokens
                : 0,
            totalTokens:
              typeof requestUsage.totalTokens === 'number'
                ? requestUsage.totalTokens
                : 0,
            ...(typeof requestUsage.cachedInputTokens === 'number'
              ? { cachedInputTokens: requestUsage.cachedInputTokens }
              : {}),
            ...(typeof requestUsage.reasoningTokens === 'number'
              ? { reasoningTokens: requestUsage.reasoningTokens }
              : {}),
            ...(typeof requestUsage.totalPrice === 'number'
              ? { totalPrice: requestUsage.totalPrice }
              : {}),
            ...(typeof requestUsage.currentContext === 'number'
              ? { currentContext: requestUsage.currentContext }
              : {}),
          }
        : null;

    return {
      ...entity,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
      requestTokenUsage,
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

    // Get all messages for this thread
    const messages = await this.messagesDao.getAll({
      threadId,
      order: { createdAt: 'ASC' },
    });

    // Initialize aggregates
    const total = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      totalPrice: 0,
      currentContext: 0,
    };

    const byNode: Record<string, TokenUsage> = {};
    const byToolMap = new Map<
      string,
      { totalTokens: number; totalPrice: number; callCount: number }
    >();

    const toolsAggregate = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      totalPrice: 0,
      currentContext: 0,
      messageCount: 0,
    };

    const messagesAggregate = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      totalPrice: 0,
      currentContext: 0,
      messageCount: 0,
    };

    // Process each message
    for (const messageEntity of messages) {
      const additionalKwargs = messageEntity.message.additionalKwargs as
        | MessageAdditionalKwargs
        | undefined;
      const requestUsage = additionalKwargs?.__requestUsage;

      if (requestUsage && typeof requestUsage === 'object') {
        const usage = {
          inputTokens:
            typeof requestUsage.inputTokens === 'number'
              ? requestUsage.inputTokens
              : 0,
          outputTokens:
            typeof requestUsage.outputTokens === 'number'
              ? requestUsage.outputTokens
              : 0,
          totalTokens:
            typeof requestUsage.totalTokens === 'number'
              ? requestUsage.totalTokens
              : 0,
          cachedInputTokens:
            typeof requestUsage.cachedInputTokens === 'number'
              ? requestUsage.cachedInputTokens
              : 0,
          reasoningTokens:
            typeof requestUsage.reasoningTokens === 'number'
              ? requestUsage.reasoningTokens
              : 0,
          totalPrice:
            typeof requestUsage.totalPrice === 'number'
              ? requestUsage.totalPrice
              : 0,
          currentContext:
            typeof requestUsage.currentContext === 'number'
              ? requestUsage.currentContext
              : typeof requestUsage.inputTokens === 'number'
                ? requestUsage.inputTokens
                : 0,
        };

        // Update total
        total.inputTokens += usage.inputTokens;
        total.outputTokens += usage.outputTokens;
        total.totalTokens += usage.totalTokens;
        total.cachedInputTokens += usage.cachedInputTokens;
        total.reasoningTokens += usage.reasoningTokens;
        total.totalPrice += usage.totalPrice;
        // currentContext is a snapshot, use the latest value
        total.currentContext = Math.max(
          total.currentContext,
          usage.currentContext,
        );

        // Update by node
        if (!byNode[messageEntity.nodeId]) {
          byNode[messageEntity.nodeId] = {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cachedInputTokens: 0,
            reasoningTokens: 0,
            totalPrice: 0,
            currentContext: 0,
          };
        }
        const nodeUsage = byNode[messageEntity.nodeId]!;
        nodeUsage.inputTokens += usage.inputTokens;
        nodeUsage.outputTokens += usage.outputTokens;
        nodeUsage.totalTokens += usage.totalTokens;
        nodeUsage.cachedInputTokens =
          (nodeUsage.cachedInputTokens ?? 0) + usage.cachedInputTokens;
        nodeUsage.reasoningTokens =
          (nodeUsage.reasoningTokens ?? 0) + usage.reasoningTokens;
        nodeUsage.totalPrice = (nodeUsage.totalPrice ?? 0) + usage.totalPrice;
        nodeUsage.currentContext = Math.max(
          nodeUsage.currentContext ?? 0,
          usage.currentContext,
        );

        // Determine if this is a tool message
        const isToolMessage =
          messageEntity.message.role === 'tool' ||
          messageEntity.message.role === 'tool-shell';

        if (isToolMessage) {
          // Update tools aggregate
          toolsAggregate.inputTokens += usage.inputTokens;
          toolsAggregate.outputTokens += usage.outputTokens;
          toolsAggregate.totalTokens += usage.totalTokens;
          toolsAggregate.cachedInputTokens += usage.cachedInputTokens;
          toolsAggregate.reasoningTokens += usage.reasoningTokens;
          toolsAggregate.totalPrice += usage.totalPrice;
          toolsAggregate.currentContext = Math.max(
            toolsAggregate.currentContext,
            usage.currentContext,
          );
          toolsAggregate.messageCount += 1;

          // Update by tool
          const toolName =
            'name' in messageEntity.message
              ? (messageEntity.message.name as string)
              : 'unknown';
          const toolStats = byToolMap.get(toolName) || {
            totalTokens: 0,
            totalPrice: 0,
            callCount: 0,
          };
          toolStats.totalTokens += usage.totalTokens;
          toolStats.totalPrice += usage.totalPrice;
          toolStats.callCount += 1;
          byToolMap.set(toolName, toolStats);
        } else {
          // Update messages aggregate for non-tool messages
          messagesAggregate.inputTokens += usage.inputTokens;
          messagesAggregate.outputTokens += usage.outputTokens;
          messagesAggregate.totalTokens += usage.totalTokens;
          messagesAggregate.cachedInputTokens += usage.cachedInputTokens;
          messagesAggregate.reasoningTokens += usage.reasoningTokens;
          messagesAggregate.totalPrice += usage.totalPrice;
          messagesAggregate.currentContext = Math.max(
            messagesAggregate.currentContext,
            usage.currentContext,
          );
          messagesAggregate.messageCount += 1;
        }
      }
    }

    // Convert byToolMap to array
    const byTool: UsageStatisticsByTool[] = Array.from(byToolMap.entries())
      .map(([toolName, stats]) => ({
        toolName,
        totalTokens: stats.totalTokens,
        totalPrice: stats.totalPrice > 0 ? stats.totalPrice : undefined,
        callCount: stats.callCount,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    return {
      total: {
        inputTokens: total.inputTokens,
        outputTokens: total.outputTokens,
        totalTokens: total.totalTokens,
        ...(total.cachedInputTokens > 0
          ? { cachedInputTokens: total.cachedInputTokens }
          : {}),
        ...(total.reasoningTokens > 0
          ? { reasoningTokens: total.reasoningTokens }
          : {}),
        ...(total.totalPrice > 0 ? { totalPrice: total.totalPrice } : {}),
        ...(total.currentContext > 0
          ? { currentContext: total.currentContext }
          : {}),
      },
      byNode,
      byTool,
      toolsAggregate: {
        inputTokens: toolsAggregate.inputTokens,
        outputTokens: toolsAggregate.outputTokens,
        totalTokens: toolsAggregate.totalTokens,
        messageCount: toolsAggregate.messageCount,
        ...(toolsAggregate.cachedInputTokens > 0
          ? { cachedInputTokens: toolsAggregate.cachedInputTokens }
          : {}),
        ...(toolsAggregate.reasoningTokens > 0
          ? { reasoningTokens: toolsAggregate.reasoningTokens }
          : {}),
        ...(toolsAggregate.totalPrice > 0
          ? { totalPrice: toolsAggregate.totalPrice }
          : {}),
        ...(toolsAggregate.currentContext > 0
          ? { currentContext: toolsAggregate.currentContext }
          : {}),
      },
      messagesAggregate: {
        inputTokens: messagesAggregate.inputTokens,
        outputTokens: messagesAggregate.outputTokens,
        totalTokens: messagesAggregate.totalTokens,
        messageCount: messagesAggregate.messageCount,
        ...(messagesAggregate.cachedInputTokens > 0
          ? { cachedInputTokens: messagesAggregate.cachedInputTokens }
          : {}),
        ...(messagesAggregate.reasoningTokens > 0
          ? { reasoningTokens: messagesAggregate.reasoningTokens }
          : {}),
        ...(messagesAggregate.totalPrice > 0
          ? { totalPrice: messagesAggregate.totalPrice }
          : {}),
        ...(messagesAggregate.currentContext > 0
          ? { currentContext: messagesAggregate.currentContext }
          : {}),
      },
    };
  }
}
