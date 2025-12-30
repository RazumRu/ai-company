import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { waitForCondition } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

describe('Thread token usage + cost from running graph state (integration)', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;

  const createdGraphIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    graphsService = app.get(GraphsService);
    threadsService = app.get(ThreadsService);
  });

  afterEach(async () => {
    while (createdGraphIds.length > 0) {
      const graphId = createdGraphIds.pop();
      if (!graphId) continue;

      try {
        await graphsService.destroy(graphId);
      } catch (error: unknown) {
        if (
          !(error instanceof BaseException) ||
          (error.errorCode !== 'GRAPH_NOT_FOUND' &&
            error.errorCode !== 'GRAPH_NOT_RUNNING')
        ) {
          throw error;
        }
      }

      try {
        await graphsService.delete(graphId);
      } catch (error: unknown) {
        if (
          !(error instanceof BaseException) ||
          error.errorCode !== 'GRAPH_NOT_FOUND'
        ) {
          throw error;
        }
      }
    }
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it(
    'creates a graph, executes it, returns tokenUsage while running, and still returns tokenUsage after stop (checkpoint fallback)',
    { timeout: 180_000 },
    async () => {
      const graph = await graphsService.create({
        name: `Thread token usage test ${Date.now()}`,
        description: 'integration test for thread token usage aggregation',
        temporary: true,
        schema: {
          nodes: [
            {
              id: 'trigger-1',
              template: 'manual-trigger',
              config: {},
            },
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'TokenUsage Agent',
                description: 'Test agent',
                instructions: 'Answer briefly.',
                invokeModelName: 'gpt-5-mini',
                enforceToolUsage: false,
                maxIterations: 3,
                summarizeMaxTokens: 272000,
                summarizeKeepTokens: 30000,
              },
            },
          ],
          edges: [{ from: 'trigger-1', to: 'agent-1' }],
        },
      });
      createdGraphIds.push(graph.id);

      await graphsService.run(graph.id);
      await waitForCondition(
        () => graphsService.findById(graph.id),
        (g) => g.status === GraphStatus.Running,
        { timeout: 60_000, interval: 1_000 },
      );

      const execution = await graphsService.executeTrigger(
        graph.id,
        'trigger-1',
        {
          messages: ['hello'],
          async: true,
          threadSubId: `token-usage-${Date.now()}`,
        },
      );

      const createdThread = await waitForCondition(
        () => threadsService.getThreadByExternalId(execution.externalThreadId),
        (t) => Boolean(t),
        { timeout: 30_000, interval: 1_000 },
      );

      // While graph is running: pull from running graph state.
      const runningThread = await waitForCondition(
        () =>
          threadsService.getThreadByExternalId(createdThread.externalThreadId),
        (t) => (t.tokenUsage?.totalTokens ?? 0) > 0,
        { timeout: 120_000, interval: 2_000 },
      );
      expect(runningThread.tokenUsage).not.toBeNull();
      expect(runningThread.tokenUsage?.totalTokens).toBeGreaterThan(0);
      expect(runningThread.tokenUsage?.currentContext).toBeGreaterThan(0);

      // Message DTOs should include per-message tokenUsage (AI messages must not be null).
      const messagesWhileRunning = await waitForCondition(
        () =>
          threadsService.getThreadMessages(createdThread.id, {
            limit: 200,
            offset: 0,
          }),
        (msgs) =>
          msgs.some((m) => m.message.role === 'ai' && m.tokenUsage !== null),
        { timeout: 30_000, interval: 1_000 },
      );

      const aiMessageWhileRunning = messagesWhileRunning.find(
        (m) => m.message.role === 'ai',
      );
      expect(aiMessageWhileRunning).toBeDefined();
      expect(aiMessageWhileRunning!.tokenUsage).not.toBeNull();
      expect(aiMessageWhileRunning!.tokenUsage?.totalTokens).toBeGreaterThan(0);

      // Wait until execution reaches a terminal status so checkpoint state is persisted.
      await waitForCondition(
        () => threadsService.getThreadById(createdThread.id),
        (t) =>
          t.status === ThreadStatus.Done ||
          t.status === ThreadStatus.NeedMoreInfo,
        { timeout: 120_000, interval: 2_000 },
      );

      // Stop the graph (unregisters it) so ThreadsService uses checkpoint fallback.
      await graphsService.destroy(graph.id);
      await waitForCondition(
        () => graphsService.findById(graph.id),
        (g) => g.status !== GraphStatus.Running,
        { timeout: 60_000, interval: 1_000 },
      );

      const stoppedThread = await waitForCondition(
        () =>
          threadsService.getThreadByExternalId(createdThread.externalThreadId),
        (t) => (t.tokenUsage?.totalTokens ?? 0) > 0,
        { timeout: 60_000, interval: 2_000 },
      );
      expect(stoppedThread.tokenUsage).not.toBeNull();
      expect(stoppedThread.tokenUsage?.totalTokens).toBeGreaterThan(0);
      expect(stoppedThread.tokenUsage?.currentContext).toBeGreaterThan(0);

      // Messages should still carry per-message tokenUsage after stop.
      const messagesAfterStop = await waitForCondition(
        () =>
          threadsService.getThreadMessages(createdThread.id, {
            limit: 200,
            offset: 0,
          }),
        (msgs) =>
          msgs.some((m) => m.message.role === 'ai' && m.tokenUsage !== null),
        { timeout: 30_000, interval: 1_000 },
      );

      const aiMessageAfterStop = messagesAfterStop.find(
        (m) => m.message.role === 'ai',
      );
      expect(aiMessageAfterStop).toBeDefined();
      expect(aiMessageAfterStop!.tokenUsage).not.toBeNull();
      expect(aiMessageAfterStop!.tokenUsage?.totalTokens).toBeGreaterThan(0);
    },
  );

  it(
    'does not reset tokenUsage when a communication tool triggers nested agent runs (integration)',
    { timeout: 240_000 },
    async () => {
      const graph = await graphsService.create({
        name: `Thread token usage comm test ${Date.now()}`,
        description:
          'integration test ensuring token usage does not reset after communication tool calls',
        temporary: true,
        schema: {
          nodes: [
            { id: 'trigger-1', template: 'manual-trigger', config: {} },
            {
              id: 'agent-1',
              template: 'simple-agent',
              config: {
                name: 'Caller Agent',
                description: 'Calls the communication tool',
                // Force a tool call so we exercise nested agent runs.
                instructions:
                  "For each user message: call the communication_exec tool once to ask agent 'Callee Agent' for a short answer, then reply to the user with the callee's answer in one sentence.",
                invokeModelName: 'gpt-5-mini',
                enforceToolUsage: false,
                maxIterations: 5,
                summarizeMaxTokens: 272000,
                summarizeKeepTokens: 30000,
              },
            },
            {
              id: 'comm-tool-1',
              template: 'agent-communication-tool',
              config: {},
            },
            {
              id: 'agent-2',
              template: 'simple-agent',
              config: {
                name: 'Callee Agent',
                description: 'Responds to the caller agent',
                instructions: 'Answer briefly (1 sentence).',
                invokeModelName: 'gpt-5-mini',
                enforceToolUsage: false,
                maxIterations: 3,
                summarizeMaxTokens: 272000,
                summarizeKeepTokens: 30000,
              },
            },
          ],
          edges: [
            { from: 'trigger-1', to: 'agent-1' },
            { from: 'agent-1', to: 'comm-tool-1' },
            { from: 'comm-tool-1', to: 'agent-2' },
          ],
        },
      });
      createdGraphIds.push(graph.id);

      await graphsService.run(graph.id);
      await waitForCondition(
        () => graphsService.findById(graph.id),
        (g) => g.status === GraphStatus.Running,
        { timeout: 60_000, interval: 1_000 },
      );

      const threadSubId = `token-usage-comm-${Date.now()}`;

      const exec1 = await graphsService.executeTrigger(graph.id, 'trigger-1', {
        messages: ['Please ask the callee agent: what is 2+2?'],
        async: true,
        threadSubId,
      });

      const thread1 = await waitForCondition(
        () => threadsService.getThreadByExternalId(exec1.externalThreadId),
        (t) => Boolean(t),
        { timeout: 30_000, interval: 1_000 },
      );

      // Ensure the communication tool actually ran (so we hit the "nested agent" path).
      await waitForCondition(
        () =>
          threadsService.getThreadMessages(thread1.id, {
            limit: 300,
            offset: 0,
          }),
        (msgs) =>
          msgs.some(
            (m) =>
              m.message.role === 'tool' &&
              m.message.name === 'communication_exec',
          ),
        { timeout: 120_000, interval: 2_000 },
      );

      const usageAfterFirst = await waitForCondition(
        () => threadsService.getThreadByExternalId(exec1.externalThreadId),
        (t) => (t.tokenUsage?.totalTokens ?? 0) > 0,
        { timeout: 120_000, interval: 2_000 },
      );

      const firstTotalTokens = usageAfterFirst.tokenUsage?.totalTokens ?? 0;
      const firstTotalPrice = usageAfterFirst.tokenUsage?.totalPrice ?? 0;

      // Nested agent usage should be attributed to the same external thread via parentThreadId.
      expect(usageAfterFirst.tokenUsage?.byNode).toBeDefined();
      expect(
        usageAfterFirst.tokenUsage?.byNode?.['agent-2']?.totalTokens ?? 0,
      ).toBeGreaterThan(0);

      // Second message on the same thread: totals must not drop (no "reset").
      await graphsService.executeTrigger(graph.id, 'trigger-1', {
        messages: ['Ask again: what is 3+3?'],
        async: true,
        threadSubId,
      });

      const usageAfterSecond = await waitForCondition(
        () => threadsService.getThreadByExternalId(exec1.externalThreadId),
        (t) => {
          const total = t.tokenUsage?.totalTokens ?? 0;
          return total >= firstTotalTokens && total > 0;
        },
        { timeout: 120_000, interval: 2_000 },
      );

      const secondTotalTokens = usageAfterSecond.tokenUsage?.totalTokens ?? 0;
      const secondTotalPrice = usageAfterSecond.tokenUsage?.totalPrice ?? 0;

      expect(secondTotalTokens).toBeGreaterThanOrEqual(firstTotalTokens);
      expect(secondTotalPrice).toBeGreaterThanOrEqual(firstTotalPrice);
    },
  );
});
