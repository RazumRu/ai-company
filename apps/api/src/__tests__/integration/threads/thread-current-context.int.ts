import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { waitForCondition } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

/**
 * Integration coverage for `tokenUsage.currentContext`.
 *
 * Requirement:
 * - currentContext must update on every invoke_llm call.
 * - currentContext must represent the request context size the provider counted.
 */

describe('Thread currentContext from invoke_llm input_tokens (integration)', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;

  let noSummarizeGraphId: string;
  let summarizeGraphId: string;

  beforeAll(async () => {
    app = await createTestModule();
    graphsService = app.get(GraphsService);
    threadsService = app.get(ThreadsService);

    const waitForRunning = async (graphId: string) => {
      await waitForCondition(
        () => graphsService.findById(graphId),
        (g) => g.status === GraphStatus.Running,
        { timeout: 60_000, interval: 1_000 },
      );
    };

    const noSummarizeGraph = await graphsService.create({
      name: `currentContext no-summarize test ${Date.now()}`,
      description:
        'integration test for invoke_llm currentContext without summarization',
      temporary: true,
      schema: {
        nodes: [
          { id: 'trigger-1', template: 'manual-trigger', config: {} },
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              name: 'Context Agent',
              description: 'Test agent',
              instructions: 'Answer briefly.',
              invokeModelName: 'gpt-5-mini',
              maxIterations: 3,
              // Make summarization effectively "off" for the purposes of this test.
              summarizeMaxTokens: 272000,
              summarizeKeepTokens: 30000,
            },
          },
        ],
        edges: [{ from: 'trigger-1', to: 'agent-1' }],
      },
    });

    noSummarizeGraphId = noSummarizeGraph.id;
    await graphsService.run(noSummarizeGraphId);
    await waitForRunning(noSummarizeGraphId);

    const summarizeGraph = await graphsService.create({
      name: `currentContext summarize test ${Date.now()}`,
      description: 'integration test for summarize reducing invoke_llm context',
      temporary: true,
      schema: {
        nodes: [
          { id: 'trigger-1', template: 'manual-trigger', config: {} },
          {
            id: 'agent-1',
            template: 'simple-agent',
            config: {
              name: 'Summarize Context Agent',
              description: 'Test agent',
              instructions: 'Answer briefly.',
              invokeModelName: 'gpt-5-mini',
              maxIterations: 5,
              // Force summarization quickly.
              summarizeMaxTokens: 200,
              summarizeKeepTokens: 30,
            },
          },
        ],
        edges: [{ from: 'trigger-1', to: 'agent-1' }],
      },
    });
    summarizeGraphId = summarizeGraph.id;
    await graphsService.run(summarizeGraphId);
    await waitForRunning(summarizeGraphId);
  }, 180_000);

  afterAll(async () => {
    const cleanup = async (graphId: string) => {
      try {
        await graphsService.destroy(graphId);
      } catch {
        // best effort
      }
      try {
        await graphsService.delete(graphId);
      } catch {
        // best effort
      }
    };

    if (noSummarizeGraphId) await cleanup(noSummarizeGraphId);
    if (summarizeGraphId) await cleanup(summarizeGraphId);
    await app.close();
  }, 180_000);

  const uniqueThreadSubId = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const ensureGraphRunning = async (graphId: string) => {
    const graph = await graphsService.findById(graphId);
    if (graph.status === GraphStatus.Running) return;
    await graphsService.run(graphId);
    await waitForCondition(
      () => graphsService.findById(graphId),
      (g) => g.status === GraphStatus.Running,
      { timeout: 60_000, interval: 1_000 },
    );
  };

  const executeAndWaitForContext = async (
    graphId: string,
    threadSubId: string,
    message: string,
    prevTotalTokens?: number,
  ) => {
    const exec = await graphsService.executeTrigger(graphId, 'trigger-1', {
      messages: [message],
      async: true,
      threadSubId,
    });

    const thread = await waitForCondition(
      () => threadsService.getThreadByExternalId(exec.externalThreadId),
      (t) => Boolean(t),
      { timeout: 60_000, interval: 1000 },
    );

    // Wait for usage statistics to be available
    const usageStats = await waitForCondition(
      async () => {
        try {
          return await threadsService.getThreadUsageStatistics(thread.id);
        } catch {
          return null;
        }
      },
      (stats) => {
        const current = stats?.total?.currentContext ?? 0;
        if (current <= 0) return false;
        if (typeof prevTotalTokens === 'number') {
          return (stats?.total?.totalTokens ?? 0) > prevTotalTokens;
        }
        return true;
      },
      { timeout: 60_000, interval: 1000 },
    );

    if (!usageStats) {
      throw new Error('Failed to get usage statistics');
    }

    return {
      externalThreadId: exec.externalThreadId,
      currentContext: usageStats.total.currentContext ?? 0,
      totalTokens: usageStats.total.totalTokens,
    };
  };

  it(
    'updates currentContext on each invoke_llm call for a thread',
    { timeout: 120_000 },
    async () => {
      await ensureGraphRunning(noSummarizeGraphId);
      const threadSubId = uniqueThreadSubId('ctx');

      const first = await executeAndWaitForContext(
        noSummarizeGraphId,
        threadSubId,
        'hello',
      );
      expect(first.currentContext).toBeGreaterThan(0);

      const second = await executeAndWaitForContext(
        noSummarizeGraphId,
        threadSubId,
        'second',
        first.totalTokens,
      );
      expect(second.externalThreadId).toBe(first.externalThreadId);
      expect(second.currentContext).toBeGreaterThan(0);
      expect(second.totalTokens).toBeGreaterThan(first.totalTokens);
    },
  );

  it(
    'summarization reduces (or keeps lower) currentContext compared to no summarization for the same message sequence',
    { timeout: 240_000 },
    async () => {
      await ensureGraphRunning(noSummarizeGraphId);
      await ensureGraphRunning(summarizeGraphId);

      const threadSubIdNoSum = uniqueThreadSubId('ctx-nosum');
      const threadSubIdSum = uniqueThreadSubId('ctx-sum');

      const messages = Array.from({ length: 5 }).map(
        (_, i) => `msg-${i}-${'x'.repeat(600)}`,
      );

      let lastNoSum = 0;
      let lastSum = 0;
      let prevNoSumTokens: number | undefined;
      let prevSumTokens: number | undefined;

      for (const msg of messages) {
        const [noSum, sum] = await Promise.all([
          executeAndWaitForContext(
            noSummarizeGraphId,
            threadSubIdNoSum,
            msg,
            prevNoSumTokens,
          ),
          executeAndWaitForContext(
            summarizeGraphId,
            threadSubIdSum,
            msg,
            prevSumTokens,
          ),
        ]);

        lastNoSum = noSum.currentContext;
        prevNoSumTokens = noSum.totalTokens;

        lastSum = sum.currentContext;
        prevSumTokens = sum.totalTokens;
      }

      expect(lastNoSum).toBeGreaterThan(0);
      expect(lastSum).toBeGreaterThan(0);
      expect(lastSum).toBeLessThanOrEqual(lastNoSum);
    },
  );
});
