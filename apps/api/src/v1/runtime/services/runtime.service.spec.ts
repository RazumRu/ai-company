import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { mock } from 'vitest-mock-extended';

import { ThreadsDao } from '../../threads/dao/threads.dao';
import { ThreadEntity } from '../../threads/entity/thread.entity';
import { RuntimeInstanceDao } from '../dao/runtime-instance.dao';
import { RuntimeInstanceEntity } from '../entity/runtime-instance.entity';
import { RuntimeInstanceStatus, RuntimeType } from '../runtime.types';
import { RuntimeService } from './runtime.service';

describe('RuntimeService', () => {
  const userId = 'user-123';

  let service: RuntimeService;
  let runtimeInstanceDao: ReturnType<typeof mock<RuntimeInstanceDao>>;
  let threadsDao: ReturnType<typeof mock<ThreadsDao>>;

  const mockCtx = {
    checkSub: vi.fn().mockReturnValue(userId),
  } as unknown as AppContextStorage;

  const threadId = '00000000-0000-0000-0000-000000000010';
  const graphId = '00000000-0000-0000-0000-000000000020';
  const externalThreadId = `${graphId}:${threadId}`;

  const mockThread = {
    id: threadId,
    graphId,
    createdBy: userId,
    projectId: 'project-abc',
    externalThreadId,
  } as ThreadEntity;

  const now = new Date('2025-06-01T12:00:00.000Z');

  const createMockInstance = (
    overrides: Partial<RuntimeInstanceEntity> = {},
  ): RuntimeInstanceEntity =>
    ({
      id: '00000000-0000-0000-0000-000000000100',
      graphId,
      nodeId: 'runtime-node-1',
      threadId,
      type: RuntimeType.Docker,
      status: RuntimeInstanceStatus.Running,
      containerName: 'test-container-123',
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    }) as RuntimeInstanceEntity;

  beforeEach(() => {
    runtimeInstanceDao = mock<RuntimeInstanceDao>();
    threadsDao = mock<ThreadsDao>();

    service = new RuntimeService(runtimeInstanceDao, threadsDao);
  });

  describe('getRuntimesForThread', () => {
    it('throws NotFoundException when thread not found or not owned', async () => {
      threadsDao.getOne.mockResolvedValue(null);

      await expect(
        service.getRuntimesForThread(mockCtx, { threadId }),
      ).rejects.toThrow('THREAD_NOT_FOUND');

      expect(threadsDao.getOne).toHaveBeenCalledWith({
        id: threadId,
        createdBy: userId,
      });
    });

    it('returns mapped runtime DTOs for owned thread', async () => {
      threadsDao.getOne.mockResolvedValue(mockThread);

      const instance1 = createMockInstance({
        id: '00000000-0000-0000-0000-000000000101',
        nodeId: 'node-1',
      });
      const instance2 = createMockInstance({
        id: '00000000-0000-0000-0000-000000000102',
        nodeId: 'node-2',
        type: RuntimeType.Daytona,
        status: RuntimeInstanceStatus.Starting,
        containerName: 'test-container-456',
      });

      runtimeInstanceDao.getAll.mockResolvedValue([instance1, instance2]);

      const result = await service.getRuntimesForThread(mockCtx, { threadId });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: '00000000-0000-0000-0000-000000000101',
        graphId,
        nodeId: 'node-1',
        externalThreadId: threadId,
        type: RuntimeType.Docker,
        status: RuntimeInstanceStatus.Running,
        containerName: 'test-container-123',
        lastUsedAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      expect(result[1]).toEqual({
        id: '00000000-0000-0000-0000-000000000102',
        graphId,
        nodeId: 'node-2',
        externalThreadId: threadId,
        type: RuntimeType.Daytona,
        status: RuntimeInstanceStatus.Starting,
        containerName: 'test-container-456',
        lastUsedAt: now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    });

    it('passes status filter to DAO when provided', async () => {
      threadsDao.getOne.mockResolvedValue(mockThread);
      runtimeInstanceDao.getAll.mockResolvedValue([]);

      await service.getRuntimesForThread(mockCtx, {
        threadId,
        status: RuntimeInstanceStatus.Running,
      });

      expect(runtimeInstanceDao.getAll).toHaveBeenCalledWith({
        threadId: externalThreadId,
        status: RuntimeInstanceStatus.Running,
      });
    });

    it('returns empty array when no runtimes exist', async () => {
      threadsDao.getOne.mockResolvedValue(mockThread);
      runtimeInstanceDao.getAll.mockResolvedValue([]);

      const result = await service.getRuntimesForThread(mockCtx, { threadId });

      expect(result).toEqual([]);
    });

    it('returns Stopped/Failed runtimes (historical)', async () => {
      threadsDao.getOne.mockResolvedValue(mockThread);

      const stoppedInstance = createMockInstance({
        status: RuntimeInstanceStatus.Stopped,
      });

      runtimeInstanceDao.getAll.mockResolvedValue([stoppedInstance]);

      const result = await service.getRuntimesForThread(mockCtx, { threadId });

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe(RuntimeInstanceStatus.Stopped);
    });
  });
});
