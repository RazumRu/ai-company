import { INestApplication } from '@nestjs/common';
import { AuthContextStorage } from '@packages/http-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GraphDao } from '../../../v1/graphs/dao/graph.dao';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { RuntimeInstanceDao } from '../../../v1/runtime/dao/runtime-instance.dao';
import {
  RuntimeInstanceStatus,
  RuntimeType,
} from '../../../v1/runtime/runtime.types';
import { RuntimeService } from '../../../v1/runtime/services/runtime.service';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { createTestModule, TEST_USER_ID } from '../setup';

const contextDataStorage = new AuthContextStorage({ sub: TEST_USER_ID });
const OTHER_USER_ID = '00000000-0000-0000-0000-000000000099';
const otherUserCtx = new AuthContextStorage({ sub: OTHER_USER_ID });

describe('RuntimeService - getRuntimesForThread (integration)', () => {
  let app: INestApplication;
  let runtimeService: RuntimeService;
  let runtimeInstanceDao: RuntimeInstanceDao;
  let threadsDao: ThreadsDao;
  let graphDao: GraphDao;

  const createdGraphIds: string[] = [];
  const createdThreadIds: string[] = [];
  const createdRuntimeIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    runtimeService = app.get(RuntimeService);
    runtimeInstanceDao = app.get(RuntimeInstanceDao);
    threadsDao = app.get(ThreadsDao);
    graphDao = app.get(GraphDao);
  }, 180_000);

  afterEach(async () => {
    for (const id of createdRuntimeIds) {
      await runtimeInstanceDao.hardDeleteById(id);
    }
    createdRuntimeIds.length = 0;

    for (const id of createdThreadIds) {
      await threadsDao.deleteById(id);
    }
    createdThreadIds.length = 0;

    for (const id of createdGraphIds) {
      await graphDao.deleteById(id);
    }
    createdGraphIds.length = 0;
  });

  afterAll(async () => {
    await app?.close();
  }, 180_000);

  const createGraph = async (name: string) => {
    const graph = await graphDao.create({
      name,
      description: 'runtime-status integration test',
      error: null,
      version: '1.0.0',
      targetVersion: '1.0.0',
      schema: { nodes: [], edges: [] },
      status: GraphStatus.Running,
      metadata: {},
      createdBy: TEST_USER_ID,
      temporary: true,
    });
    createdGraphIds.push(graph.id);
    return graph;
  };

  const createThread = async (graphId: string, userId = TEST_USER_ID) => {
    const thread = await threadsDao.create({
      graphId,
      createdBy: userId,
      externalThreadId: `runtime-status-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      metadata: {},
      source: null,
      name: null,
      status: ThreadStatus.Done,
    });
    createdThreadIds.push(thread.id);
    return thread;
  };

  const createRuntimeInstance = async (
    graphId: string,
    threadId: string,
    nodeId: string,
    overrides: Partial<{
      type: RuntimeType;
      status: RuntimeInstanceStatus;
      containerName: string;
    }> = {},
  ) => {
    const instance = await runtimeInstanceDao.create({
      graphId,
      threadId,
      nodeId,
      type: overrides.type ?? RuntimeType.Docker,
      status: overrides.status ?? RuntimeInstanceStatus.Running,
      containerName:
        overrides.containerName ??
        `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      config: {},
      temporary: false,
      lastUsedAt: new Date(),
    });
    createdRuntimeIds.push(instance.id);
    return instance;
  };

  it('returns runtime DTOs for an owned thread', async () => {
    const graph = await createGraph('runtime-happy-path');
    const thread = await createThread(graph.id);
    const instance = await createRuntimeInstance(
      graph.id,
      thread.id,
      'node-1',
    );

    const result = await runtimeService.getRuntimesForThread(
      contextDataStorage,
      { threadId: thread.id },
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: instance.id,
        graphId: graph.id,
        threadId: thread.id,
        nodeId: 'node-1',
        type: RuntimeType.Docker,
        status: RuntimeInstanceStatus.Running,
      }),
    );
    expect(result[0]!.createdAt).toBeDefined();
    expect(result[0]!.updatedAt).toBeDefined();
    expect(result[0]!.lastUsedAt).toBeDefined();
  });

  it('throws NotFoundException when thread belongs to another user', async () => {
    const graph = await createGraph('runtime-auth-check');
    const thread = await createThread(graph.id, TEST_USER_ID);

    await expect(
      runtimeService.getRuntimesForThread(otherUserCtx, {
        threadId: thread.id,
      }),
    ).rejects.toThrow('THREAD_NOT_FOUND');
  });

  it('filters by status when provided', async () => {
    const graph = await createGraph('runtime-status-filter');
    const thread = await createThread(graph.id);

    await createRuntimeInstance(graph.id, thread.id, 'node-running', {
      status: RuntimeInstanceStatus.Running,
    });
    await createRuntimeInstance(graph.id, thread.id, 'node-stopped', {
      status: RuntimeInstanceStatus.Stopped,
    });

    const runningOnly = await runtimeService.getRuntimesForThread(
      contextDataStorage,
      { threadId: thread.id, status: RuntimeInstanceStatus.Running },
    );

    expect(runningOnly).toHaveLength(1);
    expect(runningOnly[0]!.status).toBe(RuntimeInstanceStatus.Running);
    expect(runningOnly[0]!.nodeId).toBe('node-running');

    const allRuntimes = await runtimeService.getRuntimesForThread(
      contextDataStorage,
      { threadId: thread.id },
    );

    expect(allRuntimes).toHaveLength(2);
  });
});
