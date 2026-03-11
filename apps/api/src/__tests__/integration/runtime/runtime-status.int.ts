import { INestApplication } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { GraphDao } from '../../../v1/graphs/dao/graph.dao';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { ProjectsDao } from '../../../v1/projects/dao/projects.dao';
import { RuntimeInstanceDao } from '../../../v1/runtime/dao/runtime-instance.dao';
import {
  RuntimeInstanceStatus,
  RuntimeType,
} from '../../../v1/runtime/runtime.types';
import { RuntimeService } from '../../../v1/runtime/services/runtime.service';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { createTestModule, TEST_USER_ID } from '../setup';

const EMPTY_REQUEST = { headers: {} } as FastifyRequest;

const contextDataStorage = new AppContextStorage(
  { sub: TEST_USER_ID },
  EMPTY_REQUEST,
);
const OTHER_USER_ID = '00000000-0000-0000-0000-000000000099';
const otherUserCtx = new AppContextStorage(
  { sub: OTHER_USER_ID },
  EMPTY_REQUEST,
);

describe('RuntimeService - getRuntimesForThread (integration)', () => {
  let app: INestApplication;
  let runtimeService: RuntimeService;
  let runtimeInstanceDao: RuntimeInstanceDao;
  let threadsDao: ThreadsDao;
  let graphDao: GraphDao;
  let projectsDao: ProjectsDao;
  let testProjectId: string;

  const createdGraphIds: string[] = [];
  const createdThreadIds: string[] = [];
  const createdRuntimeIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    runtimeService = app.get(RuntimeService);
    runtimeInstanceDao = app.get(RuntimeInstanceDao);
    threadsDao = app.get(ThreadsDao);
    graphDao = app.get(GraphDao);
    projectsDao = app.get(ProjectsDao);

    const project = await projectsDao.create({
      name: 'Runtime Status Test Project',
      createdBy: TEST_USER_ID,
      settings: {},
    });
    testProjectId = project.id;
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
    await projectsDao.deleteById(testProjectId);
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
      projectId: testProjectId,
      temporary: true,
    });
    createdGraphIds.push(graph.id);
    return graph;
  };

  const createThread = async (graphId: string, userId = TEST_USER_ID) => {
    const thread = await threadsDao.create({
      graphId,
      createdBy: userId,
      projectId: testProjectId,
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
    externalThreadId: string,
    nodeId: string,
    overrides: Partial<{
      type: RuntimeType;
      status: RuntimeInstanceStatus;
      containerName: string;
    }> = {},
  ) => {
    const instance = await runtimeInstanceDao.create({
      graphId,
      threadId: externalThreadId,
      nodeId,
      type: overrides.type ?? RuntimeType.Docker,
      status: overrides.status ?? RuntimeInstanceStatus.Running,
      containerName:
        overrides.containerName ??
        `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      config: { image: 'test-image:latest' },
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
      thread.externalThreadId,
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
        externalThreadId: thread.externalThreadId,
        nodeId: 'node-1',
        type: RuntimeType.Docker,
        status: RuntimeInstanceStatus.Running,
        image: 'test-image:latest',
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

    await createRuntimeInstance(
      graph.id,
      thread.externalThreadId,
      'node-running',
      {
        status: RuntimeInstanceStatus.Running,
      },
    );
    await createRuntimeInstance(
      graph.id,
      thread.externalThreadId,
      'node-stopped',
      {
        status: RuntimeInstanceStatus.Stopped,
      },
    );

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
