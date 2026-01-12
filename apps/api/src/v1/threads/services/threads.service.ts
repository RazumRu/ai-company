import { Injectable } from '@nestjs/common';
import { DefaultLogger, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import Decimal from 'decimal.js';

import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import { CheckpointStateService } from '../../agents/services/checkpoint-state.service';
import { NodeKind } from '../../graphs/graphs.types';
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

    // Priority 1: Try to get usage from local state (if agent is in memory)
    try {
      const agentNodes = this.graphRegistry.getNodesByType<SimpleAgent>(
        thread.graphId,
        NodeKind.SimpleAgent,
      );

      if (agentNodes.length > 0) {
        const agent = agentNodes[0]?.instance;
        if (agent) {
          const localUsage = agent.getThreadTokenUsage(thread.externalThreadId);
          if (localUsage) {
            // Agent is in memory, use local state (fastest)
            return this.formatUsageStatistics(
              { ...localUsage },
              thread.externalThreadId,
            );
          }
        }
      }
    } catch (_error) {
      // Agent not found or not in memory, fall through to checkpoint
    }

    // Priority 2: Fallback to checkpoint (if agent not in memory)
    const checkpointUsage =
      await this.checkpointStateService.getThreadTokenUsage(
        thread.externalThreadId,
      );

    if (checkpointUsage) {
      return this.formatUsageStatistics(
        checkpointUsage,
        thread.externalThreadId,
      );
    }

    // No usage data available anywhere
    throw new NotFoundException('THREAD_USAGE_STATISTICS_NOT_FOUND');
  }

  /**
   * Format usage statistics from stored token usage data (checkpoint or local state)
   */
  private async formatUsageStatistics(
    tokenUsage: RequestTokenUsage & {
      byNode?: Record<string, RequestTokenUsage>;
    },
    externalThreadId: string,
  ): Promise<ThreadUsageStatisticsDto> {
    // We need to get messages to calculate byTool and aggregates
    // Use projection to get only needed fields (no need for full message JSONB)
    const messages = await this.messagesDao.getAll({
      externalThreadId,
      order: { createdAt: 'ASC' },
      projection: [
        'id',
        'nodeId',
        'role',
        'name',
        'requestTokenUsage',
        'toolCallNames',
      ],
    });

    // Aggregate message usage directly - separate tools from regular messages
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

    const byToolMap = new Map<
      string,
      { totalTokens: number; totalPrice: number; callCount: number }
    >();

    const byNodeMap = new Map<string, RequestTokenUsage>();

    // Use Decimal.js for price aggregation to avoid floating-point errors
    let toolsPriceDecimal = new Decimal(0);
    let messagesPriceDecimal = new Decimal(0);
    let totalRequests = 0;

    for (const messageEntity of messages) {
      const requestUsage = messageEntity.requestTokenUsage;

      // Process requestTokenUsage for LLM responses (AI, reasoning messages)
      if (requestUsage && typeof requestUsage === 'object') {
        const usage = requestUsage as RequestTokenUsage;

        // Count total requests (messages with requestTokenUsage)
        totalRequests += 1;

        // Aggregate by node
        const nodeId = messageEntity.nodeId;
        if (nodeId) {
          const nodeUsage = byNodeMap.get(nodeId) || {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          };

          nodeUsage.inputTokens += usage.inputTokens || 0;
          nodeUsage.outputTokens += usage.outputTokens || 0;
          nodeUsage.totalTokens += usage.totalTokens || 0;

          if (usage.cachedInputTokens) {
            nodeUsage.cachedInputTokens =
              (nodeUsage.cachedInputTokens || 0) + usage.cachedInputTokens;
          }
          if (usage.reasoningTokens) {
            nodeUsage.reasoningTokens =
              (nodeUsage.reasoningTokens || 0) + usage.reasoningTokens;
          }
          if (usage.totalPrice) {
            nodeUsage.totalPrice =
              (nodeUsage.totalPrice || 0) + usage.totalPrice;
          }
          if (usage.currentContext) {
            nodeUsage.currentContext = Math.max(
              nodeUsage.currentContext || 0,
              usage.currentContext,
            );
          }

          byNodeMap.set(nodeId, nodeUsage);
        }

        // Check if this AI message has tool calls (using denormalized field)
        const isAiMessage = messageEntity.role === 'ai';
        const toolCallNames = messageEntity.toolCallNames;
        const hasToolCalls =
          isAiMessage &&
          Array.isArray(toolCallNames) &&
          toolCallNames.length > 0;

        if (hasToolCalls) {
          // Update tools aggregate (AI messages WITH tool calls)
          toolsAggregate.inputTokens += usage.inputTokens || 0;
          toolsAggregate.outputTokens += usage.outputTokens || 0;
          toolsAggregate.totalTokens += usage.totalTokens || 0;
          toolsAggregate.requestCount += 1;

          if (usage.cachedInputTokens) {
            toolsAggregate.cachedInputTokens =
              (toolsAggregate.cachedInputTokens || 0) + usage.cachedInputTokens;
          }
          if (usage.reasoningTokens) {
            toolsAggregate.reasoningTokens =
              (toolsAggregate.reasoningTokens || 0) + usage.reasoningTokens;
          }
          if (usage.totalPrice) {
            toolsPriceDecimal = toolsPriceDecimal.plus(usage.totalPrice);
          }
          if (usage.currentContext) {
            toolsAggregate.currentContext = Math.max(
              toolsAggregate.currentContext || 0,
              usage.currentContext,
            );
          }

          // Attribute this AI message's requestUsage to each tool it called for byTool
          for (const toolName of toolCallNames) {
            const toolStats = byToolMap.get(toolName) || {
              totalTokens: 0,
              totalPrice: 0,
              callCount: 0,
            };

            // Divide usage across all tool calls in this message
            const usagePerTool = {
              totalTokens: Math.floor(usage.totalTokens / toolCallNames.length),
              totalPrice: (usage.totalPrice || 0) / toolCallNames.length,
            };

            toolStats.totalTokens += usagePerTool.totalTokens;
            toolStats.totalPrice += usagePerTool.totalPrice;
            toolStats.callCount += 1;
            byToolMap.set(toolName, toolStats);
          }
        } else {
          // Update messages aggregate (AI messages WITHOUT tool calls + human/system/reasoning)
          messagesAggregate.inputTokens += usage.inputTokens || 0;
          messagesAggregate.outputTokens += usage.outputTokens || 0;
          messagesAggregate.totalTokens += usage.totalTokens || 0;
          messagesAggregate.requestCount += 1;

          if (usage.cachedInputTokens) {
            messagesAggregate.cachedInputTokens =
              (messagesAggregate.cachedInputTokens || 0) +
              usage.cachedInputTokens;
          }
          if (usage.reasoningTokens) {
            messagesAggregate.reasoningTokens =
              (messagesAggregate.reasoningTokens || 0) + usage.reasoningTokens;
          }
          if (usage.totalPrice) {
            messagesPriceDecimal = messagesPriceDecimal.plus(usage.totalPrice);
          }
          if (usage.currentContext) {
            messagesAggregate.currentContext = Math.max(
              messagesAggregate.currentContext || 0,
              usage.currentContext,
            );
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

    // Convert byToolMap to array
    const byTool: UsageStatisticsByTool[] = Array.from(byToolMap.entries())
      .map(([toolName, stats]) => ({
        toolName,
        totalTokens: stats.totalTokens,
        totalPrice: stats.totalPrice > 0 ? stats.totalPrice : undefined,
        callCount: stats.callCount,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    // Convert byNodeMap to object
    const byNode: Record<string, RequestTokenUsage> =
      Object.fromEntries(byNodeMap);

    return {
      total: {
        inputTokens: tokenUsage.inputTokens ?? 0,
        outputTokens: tokenUsage.outputTokens ?? 0,
        totalTokens: tokenUsage.totalTokens ?? 0,
        ...(tokenUsage.cachedInputTokens && tokenUsage.cachedInputTokens > 0
          ? { cachedInputTokens: tokenUsage.cachedInputTokens }
          : {}),
        ...(tokenUsage.reasoningTokens && tokenUsage.reasoningTokens > 0
          ? { reasoningTokens: tokenUsage.reasoningTokens }
          : {}),
        ...(tokenUsage.totalPrice && tokenUsage.totalPrice > 0
          ? { totalPrice: tokenUsage.totalPrice }
          : {}),
        ...(tokenUsage.currentContext && tokenUsage.currentContext > 0
          ? { currentContext: tokenUsage.currentContext }
          : {}),
      },
      requests: totalRequests,
      byNode,
      byTool,
      toolsAggregate,
      messagesAggregate,
    };
  }
}
