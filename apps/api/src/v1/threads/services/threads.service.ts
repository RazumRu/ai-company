import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { AuthContextService } from '@packages/http-server';

import { GraphCheckpointsDao } from '../../agents/dao/graph-checkpoints.dao';
import { PgCheckpointSaver } from '../../agents/services/pg-checkpoint-saver';
import { NodeKind } from '../../graphs/graphs.types';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import { GraphsService } from '../../graphs/services/graphs.service';
import { MessageTransformerService } from '../../graphs/services/message-transformer.service';
import type { TokenUsage } from '../../litellm/litellm.types';
import {
  extractTokenUsageFromAdditionalKwargs,
  sumTokenUsages,
} from '../../litellm/litellm.utils';
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
    private readonly graphRegistry: GraphRegistry,
    private readonly graphCheckpointsDao: GraphCheckpointsDao,
    private readonly checkpointer: PgCheckpointSaver,
    private readonly messageTransformer: MessageTransformerService,
    private readonly authContext: AuthContextService,
    private readonly notificationsService: NotificationsService,
    private readonly graphsService: GraphsService,
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
  ): Promise<Map<string, TokenUsage | null>> {
    const out = new Map<string, TokenUsage | null>();

    // Compute each thread independently; we keep the logic in one place so callers never
    // compute token usage outside of prepareThreadsResponse().
    for (const thread of entities) {
      const running = Boolean(this.graphRegistry.get(thread.graphId));
      const tokenUsage = running
        ? this.getTokenUsageFromRunningGraph(thread)
        : await this.getTokenUsageFromCheckpoint(thread);
      out.set(thread.id, tokenUsage);
    }

    return out;
  }

  private getTokenUsageFromRunningGraph(
    thread: ThreadEntity,
  ): TokenUsage | null {
    if (!this.graphRegistry.get(thread.graphId)) {
      return null;
    }

    const agentNodes = this.graphRegistry.getNodesByType<{
      getThreadTokenUsage: (threadId: string) => TokenUsage | null;
    }>(thread.graphId, NodeKind.SimpleAgent);

    if (!agentNodes.length) {
      return null;
    }

    return sumTokenUsages(
      agentNodes.map(
        (n) => n.instance?.getThreadTokenUsage(thread.externalThreadId) ?? null,
      ),
    );
  }

  private async getTokenUsageFromCheckpoint(
    thread: ThreadEntity,
  ): Promise<TokenUsage | null> {
    const latest = await this.graphCheckpointsDao.getOne({
      threadId: thread.externalThreadId,
      order: { createdAt: 'DESC' },
      limit: 1,
    });

    if (!latest) {
      return null;
    }

    const tuple = await this.checkpointer.getTuple({
      configurable: {
        thread_id: latest.threadId,
        checkpoint_ns: latest.checkpointNs,
        checkpoint_id: latest.checkpointId,
      },
    });

    if (!tuple) {
      return null;
    }

    const channelValues =
      (tuple.checkpoint as { channel_values?: Record<string, unknown> })
        .channel_values ?? {};
    const messagesUnknown = channelValues.messages;

    if (!Array.isArray(messagesUnknown)) {
      return null;
    }

    const messageDtos =
      this.messageTransformer.transformMessagesToDto(messagesUnknown);

    return extractTokenUsageFromAdditionalKwargs(
      messageDtos.map((dto) => dto.additionalKwargs),
    );
  }

  public prepareMessageResponse(entity: MessageEntity): ThreadMessageDto {
    return {
      ...entity,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }
}
