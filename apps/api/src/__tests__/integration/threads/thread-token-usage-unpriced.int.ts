import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { RequestTokenUsage } from '../../../v1/litellm/litellm.types';
import { LitellmService } from '../../../v1/litellm/services/litellm.service';
import { ProjectsDao } from '../../../v1/projects/dao/projects.dao';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { ThreadStatus } from '../../../v1/threads/threads.types';
import { waitForCondition } from '../helpers/graph-helpers';
import { createTestProject } from '../helpers/test-context';
import { createTestModule } from '../setup';

// Assigned in beforeAll once the test project is created.
let contextDataStorage: AppContextStorage;

/**
 * Reproduces thread `499192e0-e2fe-4ec8-810a-cba28a8e86fc` symptom:
 * a model registered in LiteLLM without pricing data causes
 * `extractTokenUsageFromResponse` to return `totalPrice: null`.
 *
 * Fixed in Wave 2: message-scan source-of-truth + null propagation + hasUnpricedCalls
 * flag. This test is now GREEN.
 *
 * Verifies expected (fixed) behaviour:
 *   - result.total.totalPrice === null   (unknown, not zero)
 *   - result.total.hasUnpricedCalls === true
 *   - result.total.totalTokens > 0      (tokens still accumulate)
 */
describe('Thread token usage — unpriced model (integration)', () => {
  let app: INestApplication;
  let graphsService: GraphsService;
  let threadsService: ThreadsService;
  let litellmService: LitellmService;
  let testProjectId: string;

  const createdGraphIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    graphsService = app.get(GraphsService);
    threadsService = app.get(ThreadsService);
    litellmService = app.get(LitellmService);

    const projectResult = await createTestProject(app);
    testProjectId = projectResult.projectId;
    contextDataStorage = projectResult.ctx;
  }, 180_000);

  beforeEach(() => {
    // Simulate an unpriced model: tokens are counted but LiteLLM has no rates
    // registered for it (e.g. gpt-5.4 / gpt-codex-5.4-oauth from HYPOTHESES.md).
    // Cast until Wave 2 Step 11 widens totalPrice to number | null.
    const unpricedUsage: unknown = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      totalPrice: null,
      currentContext: 100,
      cachedInputTokens: 0,
      reasoningTokens: 0,
    };

    vi.spyOn(litellmService, 'extractTokenUsageFromResponse').mockResolvedValue(
      unpricedUsage as RequestTokenUsage,
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    while (createdGraphIds.length > 0) {
      const graphId = createdGraphIds.pop();
      if (!graphId) {
        continue;
      }

      try {
        await graphsService.destroy(contextDataStorage, graphId);
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
        await graphsService.delete(contextDataStorage, graphId);
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
    if (testProjectId) {
      try {
        await app.get(ProjectsDao).deleteById(testProjectId);
      } catch {
        // best effort cleanup
      }
    }

    await app.close();
  });

  it(
    'reports null totalPrice and hasUnpricedCalls=true when model has no registered pricing',
    { timeout: 180_000 },
    async () => {
      // Create a minimal single-agent graph — one subagent turn is enough to
      // drive messages through the pipeline and into thread token usage.
      const graph = await graphsService.create(contextDataStorage, {
        name: `Unpriced model test ${Date.now()}`,
        description:
          'Repro for 499192e0: unpriced model totalPrice null propagation',
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
                name: 'Unpriced Agent',
                description: 'Test agent using an unpriced model',
                instructions: 'Answer briefly in one sentence.',
                // Model name that would be unpriced in LiteLLM (mocked anyway).
                invokeModelName: 'gpt-5-mini',
                maxIterations: 10,
                summarizeMaxTokens: 272000,
                summarizeKeepTokens: 30000,
              },
            },
          ],
          edges: [{ from: 'trigger-1', to: 'agent-1' }],
        },
      });
      createdGraphIds.push(graph.id);

      await graphsService.run(contextDataStorage, graph.id);
      await waitForCondition(
        () => graphsService.findById(contextDataStorage, graph.id),
        (g) => g.status === GraphStatus.Running,
        { timeout: 60_000, interval: 1_000 },
      );

      const execution = await graphsService.executeTrigger(
        contextDataStorage,
        graph.id,
        'trigger-1',
        {
          messages: ['hello'],
          async: true,
          threadSubId: `unpriced-usage-${Date.now()}`,
        },
      );

      const createdThread = await waitForCondition(
        () =>
          threadsService.getThreadByExternalId(
            contextDataStorage,
            execution.externalThreadId,
          ),
        (t) => Boolean(t),
        { timeout: 30_000, interval: 1_000 },
      );

      // Wait for at least one AI message to be persisted so token counts accrue.
      await waitForCondition(
        () =>
          threadsService.getThreadMessages(
            contextDataStorage,
            createdThread.id,
            {
              limit: 200,
              offset: 0,
            },
          ),
        (msgs) => msgs.some((m) => m.message.role === 'ai'),
        { timeout: 120_000, interval: 2_000 },
      );

      // Wait for the thread to reach a terminal status so the checkpoint is persisted.
      await waitForCondition(
        () =>
          threadsService.getThreadById(contextDataStorage, createdThread.id),
        (t) =>
          t.status === ThreadStatus.Done ||
          t.status === ThreadStatus.NeedMoreInfo,
        { timeout: 120_000, interval: 2_000 },
      );

      // Stop the graph so ThreadsService falls back to message-scan / checkpoint path.
      await graphsService.destroy(contextDataStorage, graph.id);
      await waitForCondition(
        () => graphsService.findById(contextDataStorage, graph.id),
        (g) => g.status !== GraphStatus.Running,
        { timeout: 60_000, interval: 1_000 },
      );

      const result = await threadsService.getThreadUsageStatistics(
        contextDataStorage,
        createdThread.id,
      );

      // --- Matrix row 4 (all calls unpriced) assertions ---
      // Asserts null is preserved end-to-end (Change B nullable totalPrice).
      expect(result.total.totalPrice).toBe(null);

      // Asserts hasUnpricedCalls flag set when any contributor is unpriced.
      expect(result.total.hasUnpricedCalls).toBe(true);

      // Should pass even before Wave 2 — tokens always accumulate regardless of pricing.
      expect(result.total.totalTokens).toBeGreaterThan(0);
    },
  );
});
