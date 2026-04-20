import { randomUUID } from 'node:crypto';

import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BadRequestException, NotFoundException } from '@packages/common';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { ThreadEntity } from '../../threads/entity/thread.entity';
import { ThreadStoreDao } from '../dao/thread-store.dao';
import {
  ListEntriesQuery,
  NamespaceSummary,
  ThreadStoreEntry,
} from '../dto/thread-store.dto';
import { ThreadStoreEntryEntity } from '../entity/thread-store-entry.entity';
import {
  THREAD_STORE_MAX_ENTRIES_PER_NAMESPACE,
  THREAD_STORE_MAX_VALUE_BYTES,
  ThreadStoreEntryMode,
} from '../thread-store.types';

export interface PutEntryInput {
  namespace: string;
  key: string;
  value: unknown;
  authorAgentId?: string;
  tags?: string[];
}

export interface AppendEntryInput {
  namespace: string;
  value: unknown;
  authorAgentId?: string;
  tags?: string[];
}

@Injectable()
export class ThreadStoreService {
  constructor(
    private readonly threadStoreDao: ThreadStoreDao,
    private readonly em: EntityManager,
    private readonly notificationsService: NotificationsService,
  ) {}

  async put(
    ctx: AppContextStorage,
    threadId: string,
    input: PutEntryInput,
  ): Promise<ThreadStoreEntry> {
    return await this.putForUser(ctx.checkSub(), threadId, input);
  }

  async append(
    ctx: AppContextStorage,
    threadId: string,
    input: AppendEntryInput,
  ): Promise<ThreadStoreEntry> {
    return await this.appendForUser(ctx.checkSub(), threadId, input);
  }

  async get(
    ctx: AppContextStorage,
    threadId: string,
    namespace: string,
    key: string,
  ): Promise<ThreadStoreEntry | null> {
    return await this.getForUser(ctx.checkSub(), threadId, namespace, key);
  }

  async listNamespaces(
    ctx: AppContextStorage,
    threadId: string,
  ): Promise<NamespaceSummary[]> {
    return await this.listNamespacesForUser(ctx.checkSub(), threadId);
  }

  async listEntries(
    ctx: AppContextStorage,
    threadId: string,
    namespace: string,
    query?: ListEntriesQuery,
  ): Promise<ThreadStoreEntry[]> {
    return await this.listEntriesForUser(
      ctx.checkSub(),
      threadId,
      namespace,
      query,
    );
  }

  async delete(
    ctx: AppContextStorage,
    threadId: string,
    namespace: string,
    key: string,
  ): Promise<void> {
    return await this.deleteForUser(ctx.checkSub(), threadId, namespace, key);
  }

  // -- Entry points that take a userId directly. Used by agent tools, which
  // -- don't have an AppContextStorage (no HTTP request).

  async putForUser(
    userId: string,
    threadId: string,
    input: PutEntryInput,
  ): Promise<ThreadStoreEntry> {
    const thread = await this.getOwnedThread(userId, threadId);
    this.assertValueSize(input.value);
    await this.assertCapacity(threadId, input.namespace, {
      mode: ThreadStoreEntryMode.Kv,
      key: input.key,
    });

    const entity = await this.threadStoreDao.upsertKvEntry({
      threadId,
      namespace: input.namespace,
      key: input.key,
      value: input.value,
      mode: ThreadStoreEntryMode.Kv,
      authorAgentId: input.authorAgentId ?? null,
      tags: input.tags ?? null,
      createdBy: thread.createdBy,
      projectId: thread.projectId,
    });

    await this.emitUpdate(thread, entity, 'put');
    return this.toDto(entity);
  }

  async appendForUser(
    userId: string,
    threadId: string,
    input: AppendEntryInput,
  ): Promise<ThreadStoreEntry> {
    const thread = await this.getOwnedThread(userId, threadId);
    this.assertValueSize(input.value);
    await this.assertCapacity(threadId, input.namespace, {
      mode: ThreadStoreEntryMode.Append,
    });

    const generatedKey = `${new Date().toISOString()}-${randomUUID().slice(0, 8)}`;

    const entity = await this.threadStoreDao.create({
      threadId,
      namespace: input.namespace,
      key: generatedKey,
      value: input.value,
      mode: ThreadStoreEntryMode.Append,
      authorAgentId: input.authorAgentId,
      tags: input.tags,
      createdBy: thread.createdBy,
      projectId: thread.projectId,
    });

    await this.emitUpdate(thread, entity, 'append');
    return this.toDto(entity);
  }

  async getForUser(
    userId: string,
    threadId: string,
    namespace: string,
    key: string,
  ): Promise<ThreadStoreEntry | null> {
    await this.getOwnedThread(userId, threadId);
    const entity = await this.threadStoreDao.getByKey(threadId, namespace, key);
    return entity ? this.toDto(entity) : null;
  }

  async listNamespacesForUser(
    userId: string,
    threadId: string,
  ): Promise<NamespaceSummary[]> {
    await this.getOwnedThread(userId, threadId);
    const summaries = await this.threadStoreDao.getNamespaceSummaries(threadId);
    return summaries.map((s) => ({
      namespace: s.namespace,
      entryCount: s.entryCount,
      lastUpdatedAt: s.lastUpdatedAt.toISOString(),
    }));
  }

  async listEntriesForUser(
    userId: string,
    threadId: string,
    namespace: string,
    query?: ListEntriesQuery,
  ): Promise<ThreadStoreEntry[]> {
    await this.getOwnedThread(userId, threadId);
    const entities = await this.threadStoreDao.listInNamespace(
      threadId,
      namespace,
      { limit: query?.limit, offset: query?.offset },
    );
    return entities.map((entity) => this.toDto(entity));
  }

  async deleteForUser(
    userId: string,
    threadId: string,
    namespace: string,
    key: string,
  ): Promise<void> {
    const thread = await this.getOwnedThread(userId, threadId);
    const entity = await this.threadStoreDao.getByKey(threadId, namespace, key);
    if (!entity) {
      throw new NotFoundException('THREAD_STORE_ENTRY_NOT_FOUND');
    }
    if (entity.mode === ThreadStoreEntryMode.Append) {
      throw new BadRequestException(
        'THREAD_STORE_APPEND_IMMUTABLE',
        'Append-only entries cannot be deleted.',
      );
    }
    await this.threadStoreDao.deleteById(entity.id);
    await this.emitUpdate(thread, entity, 'delete');
  }

  /**
   * Resolve a thread by its `externalThreadId` (the identifier carried on
   * agent `RunnableConfig.configurable.thread_id`). Returns the internal
   * DB thread id so callers can use the standard `*ForUser` methods.
   */
  async resolveInternalThreadId(
    userId: string,
    externalThreadId: string,
  ): Promise<string> {
    const thread = await this.em.findOne(ThreadEntity, {
      externalThreadId,
      createdBy: userId,
    });
    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }
    return thread.id;
  }

  private async getOwnedThread(
    userId: string,
    threadId: string,
  ): Promise<ThreadEntity> {
    const thread = await this.em.findOne(ThreadEntity, {
      id: threadId,
      createdBy: userId,
    });
    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }
    return thread;
  }

  private assertValueSize(value: unknown): void {
    const serialized = JSON.stringify(value ?? null);
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    if (byteLength > THREAD_STORE_MAX_VALUE_BYTES) {
      throw new BadRequestException(
        'THREAD_STORE_VALUE_TOO_LARGE',
        `Value exceeds the ${THREAD_STORE_MAX_VALUE_BYTES}-byte limit (${byteLength} bytes).`,
      );
    }
  }

  private async assertCapacity(
    threadId: string,
    namespace: string,
    opts: { mode: ThreadStoreEntryMode; key?: string },
  ): Promise<void> {
    // KV upsert of an existing key doesn't add an entry -- skip the count.
    if (opts.mode === ThreadStoreEntryMode.Kv && opts.key) {
      const existing = await this.threadStoreDao.getByKey(
        threadId,
        namespace,
        opts.key,
      );
      if (existing) {
        return;
      }
    }

    const count = await this.threadStoreDao.countForNamespace(
      threadId,
      namespace,
    );
    if (count >= THREAD_STORE_MAX_ENTRIES_PER_NAMESPACE) {
      throw new BadRequestException(
        'THREAD_STORE_NAMESPACE_FULL',
        `Namespace "${namespace}" is full (${THREAD_STORE_MAX_ENTRIES_PER_NAMESPACE} entries). Delete or rotate entries before writing more.`,
      );
    }
  }

  private async emitUpdate(
    thread: ThreadEntity,
    entity: ThreadStoreEntryEntity,
    action: 'put' | 'append' | 'delete',
  ): Promise<void> {
    await this.notificationsService.emit({
      type: NotificationEvent.ThreadStoreUpdate,
      graphId: thread.graphId,
      threadId: thread.externalThreadId,
      data: {
        threadId: thread.id,
        namespace: entity.namespace,
        key: entity.key,
        mode: entity.mode,
        action,
        authorAgentId: entity.authorAgentId ?? null,
      },
    });
  }

  private toDto(entity: ThreadStoreEntryEntity): ThreadStoreEntry {
    return {
      id: entity.id,
      threadId: entity.threadId,
      namespace: entity.namespace,
      key: entity.key,
      value: entity.value,
      mode: entity.mode,
      authorAgentId: entity.authorAgentId ?? null,
      tags: entity.tags ?? null,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }
}
