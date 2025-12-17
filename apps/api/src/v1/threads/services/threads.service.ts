import { Injectable } from '@nestjs/common';
import { DefaultLogger, NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';

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
    const tokenUsageByThreadId = await this.getThreadsTokenUsage(entities);

    return entities.map((entity) => {
      const { deletedAt: _deletedAt, ...entityWithoutDeletedAt } = entity;
      return {
        ...entityWithoutDeletedAt,
        createdAt: new Date(entity.createdAt).toISOString(),
        updatedAt: new Date(entity.updatedAt).toISOString(),
        metadata: entity.metadata || {},
        tokenUsage: tokenUsageByThreadId.get(entity.id) ?? null,
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
        out.set(thread.id, redisResults.get(thread.externalThreadId) ?? null);
      }
    }

    // Handle non-running threads: read from DB
    for (const thread of nonRunningThreads) {
      out.set(thread.id, thread.tokenUsage ?? null);
    }

    return out;
  }

  public prepareMessageResponse(entity: MessageEntity): ThreadMessageDto {
    return {
      ...entity,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }
}
