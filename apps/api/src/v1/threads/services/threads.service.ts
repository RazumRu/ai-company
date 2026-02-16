import { Injectable } from '@nestjs/common';
import { DefaultLogger, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';
import Decimal from 'decimal.js';

import { CheckpointStateService } from '../../agents/services/checkpoint-state.service';
import { MessageRole } from '../../graphs/graphs.types';
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
  SetThreadMetadataDto,
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

    return this.prepareThreadsResponse(threads);
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

    return this.prepareThreadsResponse([thread])[0]!;
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

    return this.prepareThreadsResponse([thread])[0]!;
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
      return this.prepareThreadsResponse([thread])[0]!;
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
    return this.prepareThreadsResponse([thread])[0]!;
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

  async setMetadata(
    threadId: string,
    dto: SetThreadMetadataDto,
  ): Promise<ThreadDto> {
    const userId = this.authContext.checkSub();

    const thread = await this.threadDao.getOne({
      id: threadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    const updated = await this.threadDao.updateById(threadId, {
      metadata: dto.metadata,
    });

    return this.prepareThreadsResponse([updated!])[0]!;
  }

  async setMetadataByExternalId(
    externalThreadId: string,
    dto: SetThreadMetadataDto,
  ): Promise<ThreadDto> {
    const userId = this.authContext.checkSub();

    const thread = await this.threadDao.getOne({
      externalThreadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    const updated = await this.threadDao.updateById(thread.id, {
      metadata: dto.metadata,
    });

    return this.prepareThreadsResponse([updated!])[0]!;
  }

  public prepareThreadsResponse(entities: ThreadEntity[]): ThreadDto[] {
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

  public prepareThreadResponse(entity: ThreadEntity): ThreadDto {
    return this.prepareThreadsResponse([entity])[0]!;
  }

  public prepareMessageResponse(entity: MessageEntity): ThreadMessageDto {
    return {
      ...entity,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
      requestTokenUsage: entity.requestTokenUsage ?? null,
      toolTokenUsage: entity.toolTokenUsage ?? null,
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

    const threadUsage = await this.checkpointStateService.getThreadTokenUsage(
      thread.externalThreadId,
    );

    if (threadUsage) {
      totalUsage = threadUsage;

      if (threadUsage.byNode) {
        byNodeUsage = new Map(Object.entries(threadUsage.byNode));
      }
    }

    // Format usage statistics from stored token usage data.
    // Use denormalized columns instead of full message JSONB for performance.
    const messages =
      (await this.messagesDao.getAll({
        threadId: thread.id,
        order: { createdAt: 'ASC' },
        projection: [
          'id',
          'nodeId',
          'role',
          'name',
          'requestTokenUsage',
          'toolCallNames',
          'answeredToolCallNames',
          'additionalKwargs',
          'toolCallIds',
          'toolTokenUsage',
        ],
      })) ?? [];

    // Use Decimal.js for price aggregation to avoid floating-point errors
    let toolsPriceDecimal = new Decimal(0);
    let totalRequests = 0;
    let userMessageCount = 0;

    // Map: toolCallId -> parentToolName (for linking subagent internal messages)
    const toolCallIdToToolName = new Map<string, string>();

    // Map: parentToolName -> childToolName -> { callCount, totalTokens, priceDecimal }
    const subCallsByParent = new Map<
      string,
      Map<
        string,
        { callCount: number; totalTokens: number; priceDecimal: Decimal }
      >
    >();

    // Map: toolName -> { toolTokens, priceDecimal } (from tool result messages)
    const toolOwnUsage = new Map<
      string,
      { toolTokens: number; priceDecimal: Decimal }
    >();

    for (const messageEntity of messages) {
      const requestUsage = messageEntity.requestTokenUsage;
      const isAiMessage = messageEntity.role === MessageRole.AI;
      const isToolMessage = messageEntity.role === MessageRole.Tool;
      const isHumanMessage = messageEntity.role === MessageRole.Human;

      const additionalKwargs = messageEntity.additionalKwargs;
      const isSubagentInternal = additionalKwargs?.__hideForLlm === true;

      // Count user messages
      if (isHumanMessage) {
        userMessageCount++;
      }

      // Build toolCallId -> toolName mapping from non-subagent AI messages
      // Uses denormalized toolCallIds + toolCallNames columns (parallel arrays)
      if (isAiMessage && !isSubagentInternal) {
        const ids = messageEntity.toolCallIds;
        const names = messageEntity.toolCallNames;
        if (Array.isArray(ids) && Array.isArray(names)) {
          for (let i = 0; i < ids.length && i < names.length; i++) {
            if (ids[i] && names[i]) {
              toolCallIdToToolName.set(ids[i]!, names[i]!);
            }
          }
        }
      }

      // Handle subagent internal AI messages: route to subCalls instead of top-level
      if (isAiMessage && isSubagentInternal) {
        const parentToolCallId = additionalKwargs?.__toolCallId as
          | string
          | undefined;
        const parentToolName = parentToolCallId
          ? toolCallIdToToolName.get(parentToolCallId)
          : undefined;

        // Extract __requestUsage from additionalKwargs for actual token counts
        const embeddedUsage = additionalKwargs?.__requestUsage as
          | RequestTokenUsage
          | undefined;

        if (parentToolName) {
          const embeddedTokens = embeddedUsage?.totalTokens || 0;
          const embeddedPrice = embeddedUsage?.totalPrice || 0;

          // Determine child tool name(s) or use (llm_response) for no-tool responses
          const childToolNames =
            Array.isArray(messageEntity.toolCallNames) &&
            messageEntity.toolCallNames.length > 0
              ? messageEntity.toolCallNames
              : ['(llm_response)'];

          if (!subCallsByParent.has(parentToolName)) {
            subCallsByParent.set(parentToolName, new Map());
          }
          const parentSubCalls = subCallsByParent.get(parentToolName)!;

          for (const childToolName of childToolNames) {
            const current = parentSubCalls.get(childToolName);
            parentSubCalls.set(childToolName, {
              callCount: (current?.callCount || 0) + 1,
              totalTokens: (current?.totalTokens || 0) + embeddedTokens,
              priceDecimal: (current?.priceDecimal || new Decimal(0)).plus(
                embeddedPrice,
              ),
            });
          }
        }

        // Count subagent internal LLM calls in totalRequests and toolsAggregate
        if (embeddedUsage) {
          totalRequests++;

          // Attribute subagent LLM cost to toolsAggregate
          toolsPriceDecimal = toolsPriceDecimal.plus(
            embeddedUsage.totalPrice || 0,
          );
          toolsAggregate.inputTokens += embeddedUsage.inputTokens;
          toolsAggregate.outputTokens += embeddedUsage.outputTokens;
          toolsAggregate.totalTokens += embeddedUsage.totalTokens;
          toolsAggregate.requestCount++;
        }

        // Subagent internal messages don't contribute to top-level byTool
        continue;
      }

      // Count tool calls from non-subagent AI messages.
      if (
        isAiMessage &&
        Array.isArray(messageEntity.toolCallNames) &&
        messageEntity.toolCallNames.length > 0
      ) {
        for (const toolName of messageEntity.toolCallNames) {
          const current = byToolUsage.get(toolName);
          byToolUsage.set(toolName, {
            totalTokens: current?.totalTokens || 0,
            totalPrice: current?.totalPrice || 0,
            callCount: (current?.callCount || 0) + 1,
          });
        }
      }

      // Attribute token usage to tools.
      // Only count AI messages — tool messages may carry duplicated parent usage
      // in legacy data (before the notification handler fix).
      if (isAiMessage && requestUsage) {
        totalRequests++;

        let attributeToTools: string[] | undefined;

        if (
          Array.isArray(messageEntity.toolCallNames) &&
          messageEntity.toolCallNames.length > 0
        ) {
          attributeToTools = messageEntity.toolCallNames;
        } else if (
          Array.isArray(messageEntity.answeredToolCallNames) &&
          messageEntity.answeredToolCallNames.length > 0
        ) {
          attributeToTools = messageEntity.answeredToolCallNames;
        }

        if (attributeToTools && attributeToTools.length > 0) {
          toolsPriceDecimal = toolsPriceDecimal.plus(
            requestUsage.totalPrice || 0,
          );

          toolsAggregate.inputTokens += requestUsage.inputTokens;
          toolsAggregate.outputTokens += requestUsage.outputTokens;
          toolsAggregate.totalTokens += requestUsage.totalTokens;
          toolsAggregate.requestCount++;

          for (const toolName of attributeToTools) {
            const current = byToolUsage.get(toolName);
            byToolUsage.set(toolName, {
              totalTokens:
                (current?.totalTokens || 0) + requestUsage.totalTokens,
              totalPrice:
                (current?.totalPrice || 0) + (requestUsage.totalPrice || 0),
              callCount: current?.callCount || 0,
            });
          }
        }
      }

      // Track tool's own execution cost (e.g. subagent aggregate tokens) for per-tool display.
      // Do NOT add to toolsAggregate — toolTokenUsage is an aggregate of subagent internal
      // LLM calls which are already counted individually from embeddedUsage above.
      // Adding it here would double-count those tokens.
      if (isToolMessage && messageEntity.name && messageEntity.toolTokenUsage) {
        const toolUsage = messageEntity.toolTokenUsage;
        const existing = toolOwnUsage.get(messageEntity.name);
        toolOwnUsage.set(messageEntity.name, {
          toolTokens: (existing?.toolTokens || 0) + toolUsage.totalTokens,
          priceDecimal: (existing?.priceDecimal || new Decimal(0)).plus(
            toolUsage.totalPrice || 0,
          ),
        });
      }
    }

    // Finalize price aggregations
    if (!toolsPriceDecimal.isZero()) {
      toolsAggregate.totalPrice = toolsPriceDecimal.toNumber();
    }

    // Build final byTool array with subCalls and toolTokens/toolPrice
    const byTool: UsageStatisticsByTool[] = Array.from(
      byToolUsage.entries(),
    ).map(([toolName, usage]) => {
      const entry: UsageStatisticsByTool = {
        toolName,
        ...usage,
      };

      // Attach tool's own execution cost (e.g. subagent aggregate tokens)
      const ownUsage = toolOwnUsage.get(toolName);
      if (ownUsage) {
        entry.toolTokens = ownUsage.toolTokens;
        entry.toolPrice = ownUsage.priceDecimal.toNumber();
      }

      // Attach subCalls from subagent internal messages
      const subCalls = subCallsByParent.get(toolName);
      if (subCalls && subCalls.size > 0) {
        entry.subCalls = Array.from(subCalls.entries()).map(
          ([childToolName, { priceDecimal, ...childUsage }]) => ({
            toolName: childToolName,
            ...childUsage,
            totalPrice: priceDecimal.toNumber(),
          }),
        );
      }

      return entry;
    });

    return {
      total: totalUsage,
      requests: totalRequests,
      byNode: Object.fromEntries(byNodeUsage),
      byTool,
      toolsAggregate,
      userMessageCount,
    };
  }
}
