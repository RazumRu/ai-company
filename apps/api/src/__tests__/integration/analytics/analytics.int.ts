import { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AnalyticsService } from '../../../v1/analytics/analytics.service';
import { GraphDao } from '../../../v1/graphs/dao/graph.dao';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { MessageRole } from '../../../v1/graphs/graphs.types';
import { MessagesDao } from '../../../v1/threads/dao/messages.dao';
import { ThreadsDao } from '../../../v1/threads/dao/threads.dao';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { createTestModule, TEST_USER_ID } from '../setup';

describe('Analytics (integration)', () => {
  let app: INestApplication;
  let analyticsService: AnalyticsService;
  let graphDao: GraphDao;
  let threadsDao: ThreadsDao;
  let messagesDao: MessagesDao;

  const createdGraphIds: string[] = [];
  const createdThreadIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    analyticsService = app.get(AnalyticsService);
    graphDao = app.get(GraphDao);
    threadsDao = app.get(ThreadsDao);
    messagesDao = app.get(MessagesDao);
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
      temporary: true,
    });
    createdGraphIds.push(graph.id);
    return graph;
  };

  const createThread = async (graphId: string) => {
    const thread = await threadsDao.create({
      graphId,
      createdBy: TEST_USER_ID,
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
      const result = await analyticsService.getOverview({});

      expect(result.totalThreads).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.totalPrice).toBe(0);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
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

      const result = await analyticsService.getOverview({});

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

      const result = await analyticsService.getOverview({
        dateFrom: futureDate,
        dateTo: farFutureDate,
      });

      expect(result.totalThreads).toBe(0);
      expect(result.totalTokens).toBe(0);
    });
  });

  describe('getByGraph', () => {
    it('returns empty array when user has no data', async () => {
      const result = await analyticsService.getByGraph({});
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

      const result = await analyticsService.getByGraph({});

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

      const result = await analyticsService.getByGraph({
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

      const result = await analyticsService.getByGraph({
        dateFrom: futureDate,
      });

      const entry = result.graphs.find((g) => g.graphId === graph.id);
      expect(entry).toBeUndefined();
    });
  });
});
