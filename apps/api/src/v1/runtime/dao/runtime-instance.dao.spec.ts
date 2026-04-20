import type { EntityManager } from '@mikro-orm/postgresql';
import { BadRequestException, NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuntimeInstanceEntity } from '../entity/runtime-instance.entity';
import {
  RuntimeErrorCode,
  RuntimeInstanceStatus,
  RuntimeStartingPhase,
  RuntimeType,
} from '../runtime.types';
import { RuntimeInstanceDao } from './runtime-instance.dao';

function makeEntity(
  overrides: Partial<RuntimeInstanceEntity> = {},
): RuntimeInstanceEntity {
  return {
    id: 'entity-id-1',
    graphId: null,
    nodeId: 'node-1',
    threadId: 'thread-1',
    type: RuntimeType.Docker,
    containerName: 'container-1',
    status: RuntimeInstanceStatus.Running,
    config: {},
    temporary: false,
    lastUsedAt: new Date('2024-01-01T00:00:00Z'),
    startingPhase: null,
    errorCode: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  } as RuntimeInstanceEntity;
}

function createMockEm(
  findOneResult: RuntimeInstanceEntity | null,
): EntityManager {
  return {
    findOne: vi.fn().mockResolvedValue(findOneResult),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as EntityManager;
}

describe('RuntimeInstanceDao.transitionStatus', () => {
  let dao: RuntimeInstanceDao;

  beforeEach(() => {
    const em = createMockEm(null);
    dao = new RuntimeInstanceDao(em);
  });

  it('throws NotFoundException when entity is not found', async () => {
    const em = createMockEm(null);
    dao = new RuntimeInstanceDao(em);

    await expect(
      dao.transitionStatus('missing-id', RuntimeInstanceStatus.Running),
    ).rejects.toThrow(NotFoundException);

    expect(em.flush).not.toHaveBeenCalled();
  });

  it('moves Starting → Running: sets status, clears startingPhase, flushes', async () => {
    const entity = makeEntity({
      status: RuntimeInstanceStatus.Starting,
      startingPhase: RuntimeStartingPhase.Ready,
    });
    const em = createMockEm(entity);
    dao = new RuntimeInstanceDao(em);

    const result = await dao.transitionStatus(
      entity.id,
      RuntimeInstanceStatus.Running,
    );

    expect(result.status).toBe(RuntimeInstanceStatus.Running);
    expect(result.startingPhase).toBeNull();
    expect(em.flush).toHaveBeenCalledOnce();
  });

  it('moves Running → Failed with errorCode + lastError extras', async () => {
    const entity = makeEntity({ status: RuntimeInstanceStatus.Running });
    const em = createMockEm(entity);
    dao = new RuntimeInstanceDao(em);

    const result = await dao.transitionStatus(
      entity.id,
      RuntimeInstanceStatus.Failed,
      {
        errorCode: RuntimeErrorCode.Timeout,
        lastError: 'operation timed out',
      },
    );

    expect(result.status).toBe(RuntimeInstanceStatus.Failed);
    expect(result.errorCode).toBe(RuntimeErrorCode.Timeout);
    expect(result.lastError).toBe('operation timed out');
    expect(em.flush).toHaveBeenCalledOnce();
  });

  it('same-status Running → Running with no extras returns entity without flushing', async () => {
    const entity = makeEntity({ status: RuntimeInstanceStatus.Running });
    const em = createMockEm(entity);
    dao = new RuntimeInstanceDao(em);

    const result = await dao.transitionStatus(
      entity.id,
      RuntimeInstanceStatus.Running,
    );

    expect(result).toBe(entity);
    expect(em.flush).not.toHaveBeenCalled();
  });

  it('same-status Running → Running with lastUsedAt only writes lastUsedAt and flushes', async () => {
    const entity = makeEntity({ status: RuntimeInstanceStatus.Running });
    const em = createMockEm(entity);
    dao = new RuntimeInstanceDao(em);

    const newDate = new Date('2025-06-15T10:00:00Z');
    const result = await dao.transitionStatus(
      entity.id,
      RuntimeInstanceStatus.Running,
      { lastUsedAt: newDate },
    );

    expect(result.lastUsedAt).toBe(newDate);
    expect(em.flush).toHaveBeenCalledOnce();
  });

  it('rejects illegal Stopped → Starting transition with BadRequestException', async () => {
    const entity = makeEntity({ status: RuntimeInstanceStatus.Stopped });
    const em = createMockEm(entity);
    dao = new RuntimeInstanceDao(em);

    await expect(
      dao.transitionStatus(entity.id, RuntimeInstanceStatus.Starting),
    ).rejects.toThrow(BadRequestException);

    expect(em.flush).not.toHaveBeenCalled();
  });

  it('Running → Stopping clears startingPhase', async () => {
    const entity = makeEntity({
      status: RuntimeInstanceStatus.Running,
      startingPhase: RuntimeStartingPhase.Ready,
    });
    const em = createMockEm(entity);
    dao = new RuntimeInstanceDao(em);

    const result = await dao.transitionStatus(
      entity.id,
      RuntimeInstanceStatus.Stopping,
    );

    expect(result.status).toBe(RuntimeInstanceStatus.Stopping);
    expect(result.startingPhase).toBeNull();
    expect(em.flush).toHaveBeenCalledOnce();
  });

  it('transitioning to Stopped (non-Failed terminal) clears lastError and errorCode when not provided', async () => {
    const entity = makeEntity({
      status: RuntimeInstanceStatus.Stopping,
      lastError: 'some previous error',
      errorCode: RuntimeErrorCode.Unknown,
    });
    const em = createMockEm(entity);
    dao = new RuntimeInstanceDao(em);

    const result = await dao.transitionStatus(
      entity.id,
      RuntimeInstanceStatus.Stopped,
    );

    expect(result.status).toBe(RuntimeInstanceStatus.Stopped);
    expect(result.lastError).toBeNull();
    expect(result.errorCode).toBeNull();
    expect(em.flush).toHaveBeenCalledOnce();
  });
});
