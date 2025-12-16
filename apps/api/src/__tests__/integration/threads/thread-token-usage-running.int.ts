import { INestApplication } from '@nestjs/common';
import { BaseException } from '@packages/common';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { GraphStatus } from '../../../v1/graphs/graphs.types';
import { GraphsService } from '../../../v1/graphs/services/graphs.service';
import { ThreadsService } from '../../../v1/threads/services/threads.service';
import { waitForCondition } from '../helpers/graph-helpers';
import { createTestModule } from '../setup';

// Mock ChatOpenAI so integration does not depend on external LLM services.
// IMPORTANT: this mock must run before we import the integration setup/AppModule.
vi.mock('@langchain/openai', async () => {
  type InvokeArg = unknown;

  class ChatOpenAI {
    public model = ''; // empty => extractTokenUsageFromResponse uses response_cost fallback

    constructor(_fields?: Record<string, unknown>) {}

    bindTools(_tools: unknown[], _opts?: Record<string, unknown>) {
      return {
        invoke: async (_messages: InvokeArg) => {
          return {
            id: `mock-${Date.now()}`,
            name: undefined,
            content: 'ok',
            contentBlocks: [],
            tool_calls: [],
            invalid_tool_calls: [],
            response_metadata: {
              response_cost: 0.123,
            },
            usage_metadata: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              input_tokens_details: { cached_tokens: 2 },
              output_tokens_details: { reasoning_tokens: 1 },
            },
          };
        },
      };
    }

    // Best-effort support for other call sites (e.g. summarization fold)
    async invoke() {
      return { content: 'summary' };
    }

    async getNumTokens(text: string) {
      return text.length;
    }
  }

  return {
    ChatOpenAI,
  };
});

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
    { timeout: 120_000 },
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
      const runningThread = await threadsService.getThreadByExternalId(
        createdThread.externalThreadId,
      );
      expect(runningThread.tokenUsage).toEqual({
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 5,
        reasoningTokens: 1,
        totalTokens: 15,
        totalPrice: 0.123,
      });

      // Stop the graph (unregisters it) so ThreadsService uses checkpoint DB fallback.
      await graphsService.destroy(graph.id);
      await waitForCondition(
        () => graphsService.findById(graph.id),
        (g) => g.status !== GraphStatus.Running,
        { timeout: 60_000, interval: 1_000 },
      );

      const stoppedThread = await threadsService.getThreadByExternalId(
        createdThread.externalThreadId,
      );
      expect(stoppedThread.tokenUsage).toEqual({
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 5,
        reasoningTokens: 1,
        totalTokens: 15,
        totalPrice: 0.123,
      });
    },
  );
});
