import type { EntityManager } from '@mikro-orm/postgresql';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@packages/common';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { ThreadStoreDao } from '../dao/thread-store.dao';
import { ThreadStoreEntryEntity } from '../entity/thread-store-entry.entity';
import {
  THREAD_STORE_MAX_ENTRIES_PER_NAMESPACE,
  ThreadStoreEntryMode,
} from '../thread-store.types';
import { ThreadStoreService } from './thread-store.service';

type MockedDao = {
  [K in keyof ThreadStoreDao]: ReturnType<typeof vi.fn>;
};

const USER_ID = 'user-123';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const THREAD_ID = 'thread-1';
const EXTERNAL_THREAD_ID = 'graph-1:thread-1';

const buildCtx = () =>
  new AppContextStorage({ sub: USER_ID }, {
    headers: { 'x-project-id': PROJECT_ID },
  } as unknown as FastifyRequest);

const buildThread = () => ({
  id: THREAD_ID,
  externalThreadId: EXTERNAL_THREAD_ID,
  graphId: 'graph-1',
  createdBy: USER_ID,
  projectId: PROJECT_ID,
});

const buildEntry = (
  overrides: Partial<ThreadStoreEntryEntity> = {},
): ThreadStoreEntryEntity =>
  ({
    id: 'entry-1',
    threadId: THREAD_ID,
    namespace: 'plan',
    key: 'root',
    value: { ok: true },
    mode: ThreadStoreEntryMode.Kv,
    authorAgentId: 'agent-1',
    tags: null,
    createdAt: new Date('2026-04-19T10:00:00Z'),
    updatedAt: new Date('2026-04-19T10:00:00Z'),
    ...overrides,
  }) as unknown as ThreadStoreEntryEntity;

describe('ThreadStoreService', () => {
  let service: ThreadStoreService;
  let dao: MockedDao;
  let em: { findOne: ReturnType<typeof vi.fn> };
  let notifications: { emit: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    dao = {
      countForNamespace: vi.fn(),
      upsertKvEntry: vi.fn(),
      getByKey: vi.fn(),
      getNamespaceSummaries: vi.fn(),
      listInNamespace: vi.fn(),
      create: vi.fn(),
      deleteById: vi.fn(),
    } as unknown as MockedDao;
    em = { findOne: vi.fn() };
    notifications = { emit: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ThreadStoreService,
        { provide: ThreadStoreDao, useValue: dao },
        {
          provide: 'EntityManager',
          useValue: em as unknown as EntityManager,
        },
        { provide: NotificationsService, useValue: notifications },
      ],
    })
      .overrideProvider(ThreadStoreService)
      .useFactory({
        factory: () =>
          new ThreadStoreService(
            dao as unknown as ThreadStoreDao,
            em as unknown as EntityManager,
            notifications as unknown as NotificationsService,
          ),
      })
      .compile();

    service = module.get(ThreadStoreService);
  });

  it('put: persists a KV entry and emits a notification', async () => {
    em.findOne.mockResolvedValue(buildThread());
    dao.getByKey.mockResolvedValue(null);
    dao.countForNamespace.mockResolvedValue(3);
    dao.upsertKvEntry.mockResolvedValue(buildEntry());

    const result = await service.put(buildCtx(), THREAD_ID, {
      namespace: 'plan',
      key: 'root',
      value: { ok: true },
      authorAgentId: 'agent-1',
    });

    expect(result.key).toBe('root');
    expect(result.mode).toBe(ThreadStoreEntryMode.Kv);
    expect(dao.upsertKvEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: THREAD_ID,
        namespace: 'plan',
        key: 'root',
        mode: ThreadStoreEntryMode.Kv,
        createdBy: USER_ID,
        projectId: PROJECT_ID,
      }),
    );
    expect(notifications.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'thread.store.update',
        threadId: EXTERNAL_THREAD_ID,
        data: expect.objectContaining({ action: 'put', namespace: 'plan' }),
      }),
    );
  });

  it('put: throws NotFoundException when the thread is not owned by the caller', async () => {
    em.findOne.mockResolvedValue(null);

    await expect(
      service.put(buildCtx(), THREAD_ID, {
        namespace: 'plan',
        key: 'root',
        value: 'x',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('put: rejects values over the 32 KB limit', async () => {
    em.findOne.mockResolvedValue(buildThread());
    const huge = 'x'.repeat(40_000);

    await expect(
      service.put(buildCtx(), THREAD_ID, {
        namespace: 'plan',
        key: 'root',
        value: huge,
      }),
    ).rejects.toMatchObject({
      constructor: BadRequestException,
    });
  });

  it('put: rejects when the namespace is at capacity for a new key', async () => {
    em.findOne.mockResolvedValue(buildThread());
    dao.getByKey.mockResolvedValue(null);
    dao.countForNamespace.mockResolvedValue(
      THREAD_STORE_MAX_ENTRIES_PER_NAMESPACE,
    );

    await expect(
      service.put(buildCtx(), THREAD_ID, {
        namespace: 'plan',
        key: 'new',
        value: 'x',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('put: allows overwriting an existing key even at capacity', async () => {
    em.findOne.mockResolvedValue(buildThread());
    dao.getByKey.mockResolvedValue(buildEntry({ key: 'root' }));
    dao.countForNamespace.mockResolvedValue(
      THREAD_STORE_MAX_ENTRIES_PER_NAMESPACE,
    );
    dao.upsertKvEntry.mockResolvedValue(buildEntry({ key: 'root' }));

    const result = await service.put(buildCtx(), THREAD_ID, {
      namespace: 'plan',
      key: 'root',
      value: 'updated',
    });

    expect(result.key).toBe('root');
    expect(dao.upsertKvEntry).toHaveBeenCalled();
  });

  it('append: uses append mode and auto-generated key', async () => {
    em.findOne.mockResolvedValue(buildThread());
    dao.countForNamespace.mockResolvedValue(0);
    dao.create.mockResolvedValue(
      buildEntry({ mode: ThreadStoreEntryMode.Append, key: 'auto-key-1' }),
    );

    await service.append(buildCtx(), THREAD_ID, {
      namespace: 'learnings',
      value: 'never run npm ci on this box',
    });

    expect(dao.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: ThreadStoreEntryMode.Append,
        namespace: 'learnings',
      }),
    );
  });

  it('delete: refuses to delete append entries', async () => {
    em.findOne.mockResolvedValue(buildThread());
    dao.getByKey.mockResolvedValue(
      buildEntry({ mode: ThreadStoreEntryMode.Append }),
    );

    await expect(
      service.delete(buildCtx(), THREAD_ID, 'reports', 'some-key'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dao.deleteById).not.toHaveBeenCalled();
  });

  it('delete: removes a KV entry and emits a notification', async () => {
    em.findOne.mockResolvedValue(buildThread());
    dao.getByKey.mockResolvedValue(buildEntry());

    await service.delete(buildCtx(), THREAD_ID, 'plan', 'root');

    expect(dao.deleteById).toHaveBeenCalledWith('entry-1');
    expect(notifications.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'delete' }),
      }),
    );
  });

  it('resolveInternalThreadId: maps external thread id to internal id for the caller', async () => {
    em.findOne.mockResolvedValue(buildThread());

    const id = await service.resolveInternalThreadId(
      USER_ID,
      EXTERNAL_THREAD_ID,
    );

    expect(id).toBe(THREAD_ID);
    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        externalThreadId: EXTERNAL_THREAD_ID,
        createdBy: USER_ID,
      }),
    );
  });
});
