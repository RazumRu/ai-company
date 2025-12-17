import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage } from '@langchain/core/messages';
import { INestApplication } from '@nestjs/common';
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

/**
 * Integration coverage for `tokenUsage.currentContext`.
 *
 * Requirement:
 * - currentContext must update on every invoke_llm call.
 * - currentContext must represent the exact request context size the provider counted.
 *   In our pipeline, this is `usage_metadata.input_tokens` for invoke_llm.
 *
 * We mock @langchain/openai so tests don't require real LLM connectivity.
 */

let lastInvokeInputTokens = 0;
let invokeCallCount = 0;

function computeDeterministicInputTokens(messages: BaseMessage[]): number {
  // Deterministic “token” count for test purposes, derived from the exact array passed into invoke_llm.
  // Must be stable and must change when history grows / is summarized.
  let sum = 0;
  for (const m of messages) {
    const content =
      typeof (m as { content?: unknown }).content === 'string'
        ? ((m as { content?: unknown }).content as string)
        : JSON.stringify((m as { content?: unknown }).content ?? '');
    sum += content.length;
    sum += String((m as { type?: unknown }).type ?? '').length;
  }
  return sum + messages.length * 17;
}

vi.mock('@langchain/openai', () => {
  class MockChatOpenAI {
    public model: string;

    constructor(fields: { model?: string }) {
      this.model = String(fields?.model ?? 'mock-model');
    }

    // Used by summarize node for trimming decisions.
    async getNumTokens(text: string): Promise<number> {
      return text.length;
    }

    // Used by summarize node for folding older messages.
    async invoke(_messages: BaseMessage[]): Promise<AIMessage> {
      // Return a stable “summary” so the node can proceed.
      return new AIMessage('mock-summary');
    }

    bindTools(_tools: unknown[], _opts?: unknown) {
      return {
        invoke: async (messages: BaseMessage[]) => {
          const inputTokens = computeDeterministicInputTokens(messages);
          lastInvokeInputTokens = inputTokens;
          invokeCallCount += 1;

          return {
            id: `mock-${invokeCallCount}`,
            name: undefined,
            content: 'ok',
            contentBlocks: [],
            response_metadata: {},
            tool_calls: [],
            invalid_tool_calls: [],
            usage_metadata: {
              input_tokens: inputTokens,
              output_tokens: 1,
              total_tokens: inputTokens + 1,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          };
        },
      };
    }
  }

  // Important: other files import these as values (even if used as types).
  return {
    ChatOpenAI: MockChatOpenAI,
    BaseChatOpenAICallOptions: {},
    ChatOpenAIFields: {},
    OpenAIChatModelId: {},
  };
});

describe('Thread currentContext from invoke_llm input_tokens (integration)', () => {
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
      } catch {
        // best effort
      }
      try {
        await graphsService.delete(graphId);
      } catch {
        // best effort
      }
    }

    lastInvokeInputTokens = 0;
    invokeCallCount = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    'updates currentContext on each invoke_llm and equals provider input_tokens',
    { timeout: 120_000 },
    async () => {
      const graph = await graphsService.create({
        name: `currentContext test ${Date.now()}`,
        description: 'integration test for invoke_llm currentContext',
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

      const threadSubId = `ctx-${Date.now()}`;

      const exec1 = await graphsService.executeTrigger(graph.id, 'trigger-1', {
        messages: ['hello'],
        async: true,
        threadSubId,
      });

      const thread1 = await waitForCondition(
        () => threadsService.getThreadByExternalId(exec1.externalThreadId),
        (t) => (t.tokenUsage?.currentContext ?? 0) > 0,
        { timeout: 30_000, interval: 500 },
      );

      expect(thread1.tokenUsage?.currentContext).toBe(lastInvokeInputTokens);
      const first = thread1.tokenUsage?.currentContext ?? 0;

      const exec2 = await graphsService.executeTrigger(graph.id, 'trigger-1', {
        messages: ['second'],
        async: true,
        threadSubId,
      });
      expect(exec2.externalThreadId).toBe(exec1.externalThreadId);

      const thread2 = await waitForCondition(
        () => threadsService.getThreadByExternalId(exec2.externalThreadId),
        (t) => (t.tokenUsage?.currentContext ?? 0) !== first,
        { timeout: 30_000, interval: 500 },
      );

      expect(thread2.tokenUsage?.currentContext).toBe(lastInvokeInputTokens);
      expect(thread2.tokenUsage?.currentContext ?? 0).toBeGreaterThan(0);
    },
  );

  it(
    'currentContext reflects summarize shrinking (input_tokens decreases / stays bounded)',
    { timeout: 120_000 },
    async () => {
      const graph = await graphsService.create({
        name: `currentContext summarize test ${Date.now()}`,
        description:
          'integration test for summarize reducing invoke_llm context',
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
                enforceToolUsage: false,
                maxIterations: 5,
                // Force summarization quickly based on getNumTokens() = string length.
                summarizeMaxTokens: 200,
                summarizeKeepTokens: 30,
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

      const threadSubId = `ctx-sum-${Date.now()}`;
      const inputs = ['x'.repeat(120), 'y'.repeat(120), 'z'.repeat(120)];

      const observed: number[] = [];

      for (const msg of inputs) {
        const exec = await graphsService.executeTrigger(graph.id, 'trigger-1', {
          messages: [msg],
          async: true,
          threadSubId,
        });

        const thread = await waitForCondition(
          () => threadsService.getThreadByExternalId(exec.externalThreadId),
          (t) => (t.tokenUsage?.currentContext ?? 0) > 0,
          { timeout: 30_000, interval: 500 },
        );

        observed.push(thread.tokenUsage?.currentContext ?? 0);
      }

      expect(observed.length).toBe(3);
      // With summarization on, context should not grow unbounded; for our mock, it should
      // eventually stop increasing strictly (may drop or flatten depending on trim).
      const grewStrictly =
        observed[0]! < observed[1]! && observed[1]! < observed[2]!;
      expect(grewStrictly).toBe(false);
    },
  );
});
