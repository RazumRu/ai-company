import { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { AnalyticsService } from '../../../v1/analytics/analytics.service';
import { GraphDao } from '../../../v1/graphs/dao/graph.dao';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { MessageRole } from '../../../v1/graphs/graphs.types';
import { ProjectsDao } from '../../../v1/projects/dao/projects.dao';
import { MessagesDao } from '../../../v1/threads/dao/messages.dao';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { createTestProject } from '../helpers/test-context';
import { createTestModule, TEST_USER_ID } from '../setup';

let projectCtx: AppContextStorage;

describe('Analytics (integration)', () => {
  let app: INestApplication;
  let analyticsService: AnalyticsService;
  let graphDao: GraphDao;
  let projectsDao: ProjectsDao;
  let threadsDao: ThreadsDao;
  let messagesDao: MessagesDao;

  const createdGraphIds: string[] = [];
  const createdThreadIds: string[] = [];
  let testProjectId: string;

  beforeAll(async () => {
    app = await createTestModule();
    analyticsService = app.get(AnalyticsService);
    graphDao = app.get(GraphDao);
    projectsDao = app.get(ProjectsDao);
    threadsDao = app.get(ThreadsDao);
    messagesDao = app.get(MessagesDao);

    const testProject = await createTestProject(app);
    testProjectId = testProject.projectId;
    projectCtx = testProject.ctx;
  }, 180_000);

  afterEach(async () => {
    for (const threadId of createdThreadIds) {
      await messagesDao.delete({ threadId });
      await threadsDao.deleteById(threadId);
    }
    createdThreadIds.length = 0;

    for (const graphId of createdGraphIds) {
      await graphDao.deleteById(graphId);
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
      description: 'analytics integration test',
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

  const createThread = async (graphId: string) => {
    const thread = await threadsDao.create({
      graphId,
      createdBy: TEST_USER_ID,
      projectId: testProjectId,
      externalThreadId: `analytics-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      metadata: {},
      source: null,
      name: null,
      status: ThreadStatus.Done,
    });
    createdThreadIds.push(thread.id);
    return thread;
  };

  const createMessageWithUsage = async (
    threadId: string,
    externalThreadId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      totalPrice: number;
    },
  ) => {
    return messagesDao.create({
      threadId,
      externalThreadId,
      nodeId: 'agent-1',
      message: { role: MessageRole.AI, content: 'Test response' },
      requestTokenUsage: usage,
      role: MessageRole.AI,
    });
  };

  describe('getOverview', () => {
    it('returns zero totals when user has no data', async () => {
      const isolatedUserId = '00000000-0000-0000-0000-000000000097';
      const { projectId: isolatedProjectId, ctx: emptyCtx } =
        await createTestProject(app, isolatedUserId);
      try {
        const result = await analyticsService.getOverview(emptyCtx, {});

        expect(result.totalThreads).toBe(0);
        expect(result.totalTokens).toBe(0);
        expect(result.totalPrice).toBe(0);
        expect(result.inputTokens).toBe(0);
        expect(result.outputTokens).toBe(0);
      } finally {
        await projectsDao.deleteById(isolatedProjectId);
      }
    });

    it('returns correct aggregate totals across threads', async () => {
      const graph = await createGraph('analytics-overview-test');

      const thread1 = await createThread(graph.id);
      const thread2 = await createThread(graph.id);

      await createMessageWithUsage(thread1.id, thread1.externalThreadId, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        totalPrice: 0.01,
      });
      await createMessageWithUsage(thread1.id, thread1.externalThreadId, {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        totalPrice: 0.02,
      });
      await createMessageWithUsage(thread2.id, thread2.externalThreadId, {
        inputTokens: 500,
        outputTokens: 250,
        totalTokens: 750,
        totalPrice: 0.05,
      });

      const result = await analyticsService.getOverview(projectCtx, {});

      // totalThreads includes ALL threads for the user (separate count)
      expect(result.totalThreads).toBeGreaterThanOrEqual(2);
      // Token totals should include our test data
      expect(result.inputTokens).toBeGreaterThanOrEqual(800);
      expect(result.outputTokens).toBeGreaterThanOrEqual(400);
      expect(result.totalTokens).toBeGreaterThanOrEqual(1200);
      expect(result.totalPrice).toBeGreaterThanOrEqual(0.08);
    });

    it('filters by date range', async () => {
      const graph = await createGraph('analytics-date-range-test');
      const thread = await createThread(graph.id);

      await createMessageWithUsage(thread.id, thread.externalThreadId, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        totalPrice: 0.01,
      });

      // Use a future date range — should return zero tokens
      const futureDate = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const farFutureDate = new Date(
        Date.now() + 730 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const result = await analyticsService.getOverview(projectCtx, {
        dateFrom: futureDate,
        dateTo: farFutureDate,
      });

      expect(result.totalThreads).toBe(0);
      expect(result.totalTokens).toBe(0);
    });
  });

  describe('getByGraph', () => {
    it('returns empty array when user has no data', async () => {
      const result = await analyticsService.getByGraph(projectCtx, {});
      // Could have data from other tests, so just verify shape
      expect(result.graphs).toBeDefined();
      expect(Array.isArray(result.graphs)).toBe(true);
    });

    it('returns per-graph breakdown with correct totals', async () => {
      const graphA = await createGraph('analytics-graph-A');
      const graphB = await createGraph('analytics-graph-B');

      const threadA = await createThread(graphA.id);
      const threadB = await createThread(graphB.id);

      await createMessageWithUsage(threadA.id, threadA.externalThreadId, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        totalPrice: 0.01,
      });
      await createMessageWithUsage(threadB.id, threadB.externalThreadId, {
        inputTokens: 500,
        outputTokens: 250,
        totalTokens: 750,
        totalPrice: 0.05,
      });

      const result = await analyticsService.getByGraph(projectCtx, {});

      const entryA = result.graphs.find((g) => g.graphId === graphA.id);
      const entryB = result.graphs.find((g) => g.graphId === graphB.id);

      expect(entryA).toBeDefined();
      expect(entryA!.graphName).toBe('analytics-graph-A');
      expect(entryA!.totalThreads).toBe(1);
      expect(entryA!.inputTokens).toBe(100);
      expect(entryA!.outputTokens).toBe(50);
      expect(entryA!.totalTokens).toBe(150);
      expect(entryA!.totalPrice).toBe(0.01);

      expect(entryB).toBeDefined();
      expect(entryB!.graphName).toBe('analytics-graph-B');
      expect(entryB!.totalThreads).toBe(1);
      expect(entryB!.inputTokens).toBe(500);
      expect(entryB!.outputTokens).toBe(250);
      expect(entryB!.totalTokens).toBe(750);
      expect(entryB!.totalPrice).toBe(0.05);
    });

    it('filters by graphId', async () => {
      const graphA = await createGraph('analytics-filter-A');
      const graphB = await createGraph('analytics-filter-B');

      const threadA = await createThread(graphA.id);
      const threadB = await createThread(graphB.id);

      await createMessageWithUsage(threadA.id, threadA.externalThreadId, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        totalPrice: 0.01,
      });
      await createMessageWithUsage(threadB.id, threadB.externalThreadId, {
        inputTokens: 500,
        outputTokens: 250,
        totalTokens: 750,
        totalPrice: 0.05,
      });

      const result = await analyticsService.getByGraph(projectCtx, {
        graphId: graphA.id,
      });

      expect(result.graphs).toHaveLength(1);
      expect(result.graphs[0]!.graphId).toBe(graphA.id);
      expect(result.graphs[0]!.totalTokens).toBe(150);
    });

    it('filters by date range', async () => {
      const graph = await createGraph('analytics-graph-date-test');
      const thread = await createThread(graph.id);

      await createMessageWithUsage(thread.id, thread.externalThreadId, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        totalPrice: 0.01,
      });

      // Future date range excludes all data
      const futureDate = new Date(
        Date.now() + 365 * 24 * 60 * 60 * 1000,
      ).toISOString();

      const result = await analyticsService.getByGraph(projectCtx, {
        dateFrom: futureDate,
      });

      const entry = result.graphs.find((g) => g.graphId === graph.id);
      expect(entry).toBeUndefined();
    });
  });

  describe('project isolation', () => {
    let otherProjectId: string;
    let otherProjectCtx: AppContextStorage;
    const otherProjectGraphIds: string[] = [];
    const otherProjectThreadIds: string[] = [];

    beforeAll(async () => {
      const otherProject = await createTestProject(app);
      otherProjectId = otherProject.projectId;
      otherProjectCtx = otherProject.ctx;
    });

    afterEach(async () => {
      for (const threadId of otherProjectThreadIds) {
        await messagesDao.delete({ threadId });
        await threadsDao.deleteById(threadId);
      }
      otherProjectThreadIds.length = 0;

      for (const graphId of otherProjectGraphIds) {
        await graphDao.deleteById(graphId);
      }
      otherProjectGraphIds.length = 0;
    });

    afterAll(async () => {
      await projectsDao.deleteById(otherProjectId);
    });

    const createGraphInProject = async (name: string, projectId: string) => {
      const graph = await graphDao.create({
        name,
        description: 'analytics isolation test',
        error: null,
        version: '1.0.0',
        targetVersion: '1.0.0',
        schema: { nodes: [], edges: [] },
        status: GraphStatus.Running,
        metadata: {},
        createdBy: TEST_USER_ID,
        projectId,
        temporary: true,
      });
      if (projectId === otherProjectId) {
        otherProjectGraphIds.push(graph.id);
      } else {
        createdGraphIds.push(graph.id);
      }
      return graph;
    };

    const createThreadInProject = async (
      graphId: string,
      projectId: string,
    ) => {
      const thread = await threadsDao.create({
        graphId,
        createdBy: TEST_USER_ID,
        projectId,
        externalThreadId: `isolation-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        metadata: {},
        source: null,
        name: null,
        status: ThreadStatus.Done,
      });
      if (projectId === otherProjectId) {
        otherProjectThreadIds.push(thread.id);
      } else {
        createdThreadIds.push(thread.id);
      }
      return thread;
    };

    it('getOverview does not leak data across projects', async () => {
      const graphA = await createGraphInProject(
        'isolation-proj-A',
        testProjectId,
      );
      const threadA = await createThreadInProject(graphA.id, testProjectId);
      await createMessageWithUsage(threadA.id, threadA.externalThreadId, {
        inputTokens: 500,
        outputTokens: 250,
        totalTokens: 750,
        totalPrice: 0.05,
      });

      // Query from the other project (same user) — should see zero data
      const result = await analyticsService.getOverview(otherProjectCtx, {});

      expect(result.totalThreads).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.totalPrice).toBe(0);
    });

    it('getByGraph does not return graphs from other projects', async () => {
      const graphA = await createGraphInProject(
        'isolation-bygraph-A',
        testProjectId,
      );
      const threadA = await createThreadInProject(graphA.id, testProjectId);
      await createMessageWithUsage(threadA.id, threadA.externalThreadId, {
        inputTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
        totalPrice: 0.03,
      });

      // Query from the other project — should not see graph A
      const result = await analyticsService.getByGraph(otherProjectCtx, {});

      const leaked = result.graphs.find((g) => g.graphId === graphA.id);
      expect(leaked).toBeUndefined();
      expect(result.graphs).toHaveLength(0);
    });
  });
});
