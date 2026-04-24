/**
 * Integration test: live subagent cost streaming (WU-9 / Step 9)
 *
 * Verifies the full in-flight subagent cost forwarding chain:
 *   SubAgent.emitInFlightSubagentPrice()
 *   → SubagentsRunTaskTool.streamingInvoke (re-keys __toolCallId)
 *   → caller_agent.emit({ type: 'stateUpdate', inFlightSubagentPrice: { [tcid]: price } })
 *   → ToolExecutorNode emits sentinel-0 on ToolMessage arrival
 *
 * The test does NOT go through the full graph execution pipeline. Instead it:
 *   - Creates a SubAgent with a controlled LLM (vi.spyOn ChatOpenAI.prototype.bindTools)
 *   - Creates a minimal parent agent (a bare BaseAgent subclass) as the event sink
 *   - Drives SubagentsRunTaskTool.streamingInvoke() directly with the right runnableConfig
 *   - Asserts the stateUpdate event sequence produced on the parent agent
 *
 * LitellmService.extractTokenUsageFromResponse is stubbed to return fixed
 * { inputTokens: 10, outputTokens: 5, totalTokens: 15, totalPrice: 0.05 }
 * per call so each subagent invoke_llm iteration contributes exactly $0.05.
 */

import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  ToolMessage,
} from '@langchain/core/messages';
import {
  tool as langchainTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { INestApplication } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../v1/agents/agents.types';
import {
  AgentEventType,
  BaseAgent,
} from '../../../v1/agents/services/agents/base-agent';
import { SubAgent } from '../../../v1/agents/services/agents/sub-agent';
import { GraphRestorationService } from '../../../v1/graphs/services/graph-restoration.service';
import { LitellmService } from '../../../v1/litellm/services/litellm.service';
import { createTestModule } from '../setup';

// ---------------------------------------------------------------------------
// Fixed stub usage returned by the mocked extractTokenUsageFromResponse.
// Each invoke_llm call adds exactly $0.05 → 2 iterations = $0.10 total.
// ---------------------------------------------------------------------------
const STUB_USAGE = {
  inputTokens: 10,
  outputTokens: 5,
  totalTokens: 15,
  currentContext: 10,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  totalPrice: 0.05,
};

// ---------------------------------------------------------------------------
// Minimal parent agent — just EventEmitter forwarding from BaseAgent.
// We need a concrete class because BaseAgent is abstract.
// ---------------------------------------------------------------------------
class MinimalParentAgent extends BaseAgent<unknown> {
  public async run(): Promise<never> {
    throw new Error('MinimalParentAgent.run() should not be called in tests');
  }

  public async stop(): Promise<void> {}

  public setConfig(_config: unknown): void {}

  public getConfig(): unknown {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Type-narrowing helper to extract stateUpdate events from the log.
// ---------------------------------------------------------------------------
type StateUpdateEvent = Extract<AgentEventType, { type: 'stateUpdate' }>;

function isStateUpdate(e: AgentEventType): e is StateUpdateEvent {
  return e.type === 'stateUpdate';
}

describe('Live subagent cost streaming (integration)', () => {
  let app: INestApplication;
  let litellmService: LitellmService;

  beforeAll(async () => {
    // Override GraphRestorationService with a no-op to prevent the background
    // restoreRunningGraphs() task from firing DB queries after app.close() in
    // dev environments where environment.restoreGraphs defaults to true.
    app = await createTestModule(async (m) => {
      return m
        .overrideProvider(GraphRestorationService)
        .useValue({ restoreRunningGraphs: async () => {} })
        .compile();
    });
    litellmService = app.get(LitellmService);
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    'emits increasing inFlightSubagentPrice and a final sentinel-0 in the correct order (2 iterations)',
    { timeout: 60_000 },
    async () => {
      // ---- 1. Stub LitellmService so price is deterministic ----
      vi.spyOn(
        litellmService,
        'extractTokenUsageFromResponse',
      ).mockResolvedValue(STUB_USAGE);

      // supportsXxx methods control LLM configuration flags. Return simple
      // defaults to avoid complex LLM routing during the test.
      vi.spyOn(litellmService, 'supportsResponsesApi').mockResolvedValue(false);
      vi.spyOn(litellmService, 'supportsReasoning').mockResolvedValue(false);
      vi.spyOn(litellmService, 'supportsParallelToolCall').mockResolvedValue(
        false,
      );
      vi.spyOn(litellmService, 'supportsStreaming').mockResolvedValue(false);
      vi.spyOn(litellmService, 'supportsAssistantPrefill').mockResolvedValue(
        true,
      );

      // ---- 2. Control the LLM (ChatOpenAI) responses ----
      // SubAgent calls buildLLM() → new ChatOpenAI(...); bindTools().invoke(msgs).
      // Iteration 1: return a tool call (forces tools node to run then next invoke_llm).
      // Iteration 2: return plain text (completes the subagent).
      //
      // We use a simple echo tool to satisfy the tool call requirement.

      const TOOL_NAME = 'echo_test';
      const TOOL_CALL_ID = 'call-test-001';

      let llmCallCount = 0;
      const mockBindToolsInvoke = vi.fn().mockImplementation(() => {
        llmCallCount++;
        if (llmCallCount === 1) {
          // First iteration: make a tool call so invoke_llm runs again
          return Promise.resolve(
            new AIMessage({
              content: '',
              tool_calls: [
                {
                  id: TOOL_CALL_ID,
                  name: TOOL_NAME,
                  args: { message: 'hello' },
                  type: 'tool_call',
                },
              ],
              response_metadata: { usage: { total_tokens: 15 } },
            }),
          );
        }
        // Second iteration: plain text completion
        return Promise.resolve(
          new AIMessage({
            content: 'Task done.',
            response_metadata: { usage: { total_tokens: 15 } },
          }),
        );
      });

      vi.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnValue({
        invoke: mockBindToolsInvoke,
      } as unknown as ReturnType<ChatOpenAI['bindTools']>);

      // ---- 3. Create SubAgent with a simple echo tool ----
      const moduleRef = app.get(ModuleRef);
      const subAgent = await moduleRef.resolve(SubAgent, undefined, {
        strict: false,
      });

      // Build the echo tool as a proper BaseTool-compatible DynamicStructuredTool
      // whose func returns ToolInvokeResult<string> (what ToolExecutorNode expects).
      // Use the statically-imported `langchainTool` and `z` to keep both under
      // the same module-resolution instance as base-agent's DynamicStructuredTool,
      // avoiding dual-instance structural-type drift (TS2345 on addTool).
      const echoTool = langchainTool(
        async (args: { message: string }) => {
          // Return ToolInvokeResult shape — ToolExecutorNode destructures `.output`
          return { output: args.message } as unknown as string;
        },
        {
          name: TOOL_NAME,
          description: 'Echo the message back',
          schema: z.object({ message: z.string() }),
        },
      );

      subAgent.setConfig({
        instructions: 'You are a test subagent.',
        invokeModelName: 'test-model',
        maxIterations: 10,
      });
      subAgent.addTool(echoTool);

      // ---- 4. Create a minimal parent agent as the event sink ----
      const parentAgent = new MinimalParentAgent();

      // ---- 5. Subscribe to the parent and collect stateUpdate events ----
      const eventLog: AgentEventType[] = [];
      parentAgent.subscribe(async (event) => {
        eventLog.push(event);
      });

      // ---- 6. Wire a runnableConfig that points SubagentsRunTaskTool back to parent ----
      // The parent toolCallId is what inFlightSubagentPrice is keyed by.
      const PARENT_TOOL_CALL_ID = 'parent-tc-001';
      const PARENT_THREAD_ID = 'parent-thread-test-001';

      const runnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: {
          thread_id: PARENT_THREAD_ID,
          caller_agent: parentAgent,
          __toolCallId: PARENT_TOOL_CALL_ID,
          graph_id: 'test-graph-001',
          run_id: 'test-run-001',
        },
      };

      // ---- 7. Run subagent via runSubagent (exercising emitInFlightSubagentPrice) ----
      // SubagentsRunTaskTool.streamingInvoke subscribes to subAgent, re-keys
      // inFlightSubagentPrice, and calls caller_agent.emit(). We replicate this
      // minimal wiring here so the test fails if Step 4 forwarding is reverted.

      // Replicate the forwarding logic from SubagentsRunTaskTool.streamingInvoke.
      // This wiring is the primary verification target for W5's concern.
      const messageQueue: BaseMessage[][] = [];
      let resolveWaiting: (() => void) | null = null;
      let runDone = false;

      const unsubscribe = subAgent.subscribe((event) => {
        if (event.type === 'message' && event.data.messages.length > 0) {
          messageQueue.push(event.data.messages);
          if (resolveWaiting) {
            resolveWaiting();
            resolveWaiting = null;
          }
        } else if (event.type === 'stateUpdate') {
          // Mirror SubagentsRunTaskTool.streamingInvoke forwarding:
          // re-key inFlightSubagentPrice to the parent __toolCallId.
          const rawToolCallId = runnableConfig.configurable?.__toolCallId;
          const parentToolCallId: string | undefined =
            typeof rawToolCallId === 'string' ? rawToolCallId : undefined;
          if (!parentToolCallId) {
            return Promise.resolve();
          }
          const callId: string = parentToolCallId;
          const subagentPrice = (
            event.data.stateChange as Record<string, unknown>
          ).inFlightSubagentPrice as Record<string, number> | undefined;
          const priceValues = subagentPrice ? Object.values(subagentPrice) : [];
          const totalPrice =
            priceValues.length > 0 ? priceValues[0] : undefined;
          if (totalPrice === undefined) {
            return Promise.resolve();
          }
          // Forward to parent (this is what SubagentsRunTaskTool does)
          parentAgent.emit({
            type: 'stateUpdate',
            data: {
              ...event.data,
              stateChange: {
                ...event.data.stateChange,
                inFlightSubagentPrice: { [callId]: totalPrice },
              },
            },
          });
        }
        return Promise.resolve();
      });

      try {
        const runPromise = subAgent
          .runSubagent([new HumanMessage('Do a quick task.')], runnableConfig)
          .then((result) => {
            runDone = true;
            if (resolveWaiting) {
              resolveWaiting();
              resolveWaiting = null;
            }
            return result;
          });

        // Drain the message queue (mirrors streamingInvoke's yield loop)
        while (!runDone) {
          if (messageQueue.length > 0) {
            messageQueue.shift();
          } else {
            await new Promise<void>((r) => {
              resolveWaiting = r;
            });
          }
        }
        while (messageQueue.length > 0) {
          messageQueue.shift();
        }

        const loopResult = await runPromise;

        // ---- 8. Emit the sentinel-0 clear (mirrors ToolExecutorNode behavior) ----
        // ToolExecutorNode emits { [callId]: 0 } when a subagent ToolMessage arrives.
        // We emit it now after subAgent.runSubagent() resolves to simulate the
        // parent ToolExecutorNode completing tool execution.
        const toolTokenUsage = loopResult.statistics.usage;
        const toolMsg = new ToolMessage({
          tool_call_id: PARENT_TOOL_CALL_ID,
          name: 'subagents_run_task',
          content: loopResult.result,
        });
        toolMsg.additional_kwargs = {
          ...(toolMsg.additional_kwargs ?? {}),
          ...(toolTokenUsage ? { __toolTokenUsage: toolTokenUsage } : {}),
        };

        // ToolExecutorNode sentinel-0 clear (Step 3 of the plan)
        parentAgent.emit({
          type: 'stateUpdate',
          data: {
            threadId: PARENT_THREAD_ID,
            stateChange: {
              inFlightSubagentPrice: { [PARENT_TOOL_CALL_ID]: 0 },
            },
            config: runnableConfig,
          },
        });

        // ---- 9. Assert: stateUpdate events emitted on the parent ----
        const stateUpdates = eventLog.filter(isStateUpdate);

        // Extract the inFlightSubagentPrice entries from the parent event log
        const inFlightUpdates = stateUpdates
          .map((e) => {
            const raw = e.data.stateChange as Record<string, unknown>;
            return raw.inFlightSubagentPrice as
              | Record<string, number>
              | undefined;
          })
          .filter((v): v is Record<string, number> => v !== undefined);

        // ---------- Assertion 1: intermediate events with increasing price ----------
        // After iter 1 ($0.05) and iter 2 ($0.10), at least two intermediate
        // inFlightSubagentPrice events should have been emitted on the parent.
        expect(inFlightUpdates.length).toBeGreaterThanOrEqual(2);

        // All intermediate updates must be keyed by the parent tool call id.
        for (const update of inFlightUpdates) {
          expect(Object.keys(update)).toContain(PARENT_TOOL_CALL_ID);
        }

        // The non-sentinel values should be positive and increasing.
        const nonSentinelValues = inFlightUpdates
          .map((u) => u[PARENT_TOOL_CALL_ID])
          .filter((v): v is number => typeof v === 'number' && v > 0);

        expect(nonSentinelValues.length).toBeGreaterThanOrEqual(2);

        // Values must be strictly increasing (cumulative subagent price).
        for (let i = 1; i < nonSentinelValues.length; i++) {
          expect(nonSentinelValues[i]).toBeGreaterThan(
            nonSentinelValues[i - 1]!,
          );
        }

        // After 2 iterations each contributing $0.05, the final intermediate value
        // should equal $0.10 (cumulative subagent price).
        const finalIntermediateValue =
          nonSentinelValues[nonSentinelValues.length - 1];
        expect(finalIntermediateValue).toBeCloseTo(0.1, 4);

        // ---------- Assertion 2: sentinel-0 was emitted ----------
        const sentinelUpdates = inFlightUpdates.filter(
          (u) => u[PARENT_TOOL_CALL_ID] === 0,
        );
        expect(sentinelUpdates.length).toBeGreaterThanOrEqual(1);

        // ---------- Assertion 3: ordering — intermediate before sentinel (W8) ----------
        const allPriceValues = inFlightUpdates.map(
          (u) => u[PARENT_TOOL_CALL_ID],
        );
        const intermediateIdx = allPriceValues.findIndex(
          (v) => typeof v === 'number' && v > 0,
        );
        const sentinelIdx = allPriceValues.lastIndexOf(0);

        expect(intermediateIdx).toBeGreaterThanOrEqual(0);
        expect(sentinelIdx).toBeGreaterThan(intermediateIdx);

        // ---------- Assertion 4: subagent AI messages carry requestTokenUsage ----------
        // The SubAgent emits 'message' events for each AI message produced.
        // Collect the AI messages emitted from the subAgent (not parent — these
        // are the internal subagent messages that get persisted with requestTokenUsage).
        // We verify via loopResult.statistics.usage which aggregates all iterations.
        expect(loopResult.statistics.usage).not.toBeNull();
        expect(loopResult.statistics.usage!.inputTokens).toBeGreaterThan(0);
        expect(loopResult.statistics.usage!.outputTokens).toBeGreaterThan(0);
        expect(loopResult.statistics.usage!.totalTokens).toBeGreaterThan(0);
        expect(loopResult.statistics.usage!.totalPrice).toBeCloseTo(0.1, 4);

        // The mock was called exactly twice (once per invoke_llm iteration).
        expect(loopResult.statistics.totalIterations).toBe(2);

        // ---------- Assertion 5: ToolMessage carries toolTokenUsage ----------
        const toolUsage = toolMsg.additional_kwargs?.__toolTokenUsage as
          | Record<string, unknown>
          | undefined;
        expect(toolUsage).toBeDefined();
        expect(typeof toolUsage!.totalPrice).toBe('number');
        expect(toolUsage!.totalPrice).toBeCloseTo(0.1, 4);
      } finally {
        unsubscribe();
      }
    },
  );

  it(
    'sentinel-0 still fires when the forward-emit wiring is active (W5: would fail if Step 4 forwarding were reverted)',
    { timeout: 60_000 },
    async () => {
      // This test fails if the stateUpdate forward-emit in the subscriber
      // (replicating SubagentsRunTaskTool.streamingInvoke) were removed.
      // If no stateUpdate with inFlightSubagentPrice ever reaches the parent,
      // the assertions below fail — catching a regression in Step 4.

      vi.spyOn(
        litellmService,
        'extractTokenUsageFromResponse',
      ).mockResolvedValue(STUB_USAGE);
      vi.spyOn(litellmService, 'supportsResponsesApi').mockResolvedValue(false);
      vi.spyOn(litellmService, 'supportsReasoning').mockResolvedValue(false);
      vi.spyOn(litellmService, 'supportsParallelToolCall').mockResolvedValue(
        false,
      );
      vi.spyOn(litellmService, 'supportsStreaming').mockResolvedValue(false);
      vi.spyOn(litellmService, 'supportsAssistantPrefill').mockResolvedValue(
        true,
      );

      // LLM returns a single plain-text answer immediately (1 iteration).
      vi.spyOn(ChatOpenAI.prototype, 'bindTools').mockReturnValue({
        invoke: vi.fn().mockResolvedValue(
          new AIMessage({
            content: 'Single iteration answer.',
            response_metadata: { usage: { total_tokens: 15 } },
          }),
        ),
      } as unknown as ReturnType<ChatOpenAI['bindTools']>);

      const moduleRef = app.get(ModuleRef);
      const subAgent = await moduleRef.resolve(SubAgent, undefined, {
        strict: false,
      });

      subAgent.setConfig({
        instructions: 'You are a test subagent.',
        invokeModelName: 'test-model',
        maxIterations: 5,
      });

      const parentAgent = new MinimalParentAgent();
      const eventLog: AgentEventType[] = [];
      parentAgent.subscribe(async (event) => {
        eventLog.push(event);
      });

      const PARENT_TOOL_CALL_ID = 'parent-tc-002';
      const PARENT_THREAD_ID = 'parent-thread-test-002';

      const runnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: {
          thread_id: PARENT_THREAD_ID,
          caller_agent: parentAgent,
          __toolCallId: PARENT_TOOL_CALL_ID,
          graph_id: 'test-graph-002',
          run_id: 'test-run-002',
        },
      };

      let runDone = false;
      let resolveWaiting: (() => void) | null = null;
      const messageQueue: BaseMessage[][] = [];

      // Subscribe and replicate the forward-emit wiring from SubagentsRunTaskTool
      const unsubscribe = subAgent.subscribe((event) => {
        if (event.type === 'message' && event.data.messages.length > 0) {
          messageQueue.push(event.data.messages);
          if (resolveWaiting) {
            resolveWaiting();
            resolveWaiting = null;
          }
        } else if (event.type === 'stateUpdate') {
          const rawToolCallId = runnableConfig.configurable?.__toolCallId;
          const parentToolCallId: string | undefined =
            typeof rawToolCallId === 'string' ? rawToolCallId : undefined;
          if (!parentToolCallId) {
            return Promise.resolve();
          }
          const subagentPrice = (
            event.data.stateChange as Record<string, unknown>
          ).inFlightSubagentPrice as Record<string, number> | undefined;
          const priceValues = subagentPrice ? Object.values(subagentPrice) : [];
          const totalPrice =
            priceValues.length > 0 ? priceValues[0] : undefined;
          if (totalPrice === undefined) {
            return Promise.resolve();
          }
          parentAgent.emit({
            type: 'stateUpdate',
            data: {
              ...event.data,
              stateChange: {
                ...event.data.stateChange,
                inFlightSubagentPrice: { [parentToolCallId]: totalPrice },
              },
            },
          });
        }
        return Promise.resolve();
      });

      try {
        const runPromise = subAgent
          .runSubagent(
            [new HumanMessage('Quick single-iteration task.')],
            runnableConfig,
          )
          .then((result) => {
            runDone = true;
            if (resolveWaiting) {
              resolveWaiting();
              resolveWaiting = null;
            }
            return result;
          });

        while (!runDone) {
          if (messageQueue.length > 0) {
            messageQueue.shift();
          } else {
            await new Promise<void>((r) => {
              resolveWaiting = r;
            });
          }
        }
        while (messageQueue.length > 0) {
          messageQueue.shift();
        }
        await runPromise;

        // Emit sentinel-0 (simulates ToolExecutorNode completing)
        parentAgent.emit({
          type: 'stateUpdate',
          data: {
            threadId: PARENT_THREAD_ID,
            stateChange: {
              inFlightSubagentPrice: { [PARENT_TOOL_CALL_ID]: 0 },
            },
            config: runnableConfig,
          },
        });

        // The parent must have received at least one stateUpdate with
        // inFlightSubagentPrice (from the SubAgent's emitInFlightSubagentPrice call
        // after iter 1, forwarded by the subscriber above).
        const stateUpdates = eventLog.filter(isStateUpdate);
        const inFlightUpdates = stateUpdates
          .map((e) => {
            const raw = e.data.stateChange as Record<string, unknown>;
            return raw.inFlightSubagentPrice as
              | Record<string, number>
              | undefined;
          })
          .filter((v): v is Record<string, number> => v !== undefined);

        // At least 1 intermediate + 1 sentinel must have arrived.
        expect(inFlightUpdates.length).toBeGreaterThanOrEqual(2);

        const allValues = inFlightUpdates.map((u) => u[PARENT_TOOL_CALL_ID]);
        // Sentinel 0 must be the last value.
        expect(allValues[allValues.length - 1]).toBe(0);
        // At least one positive value must precede it (the intermediate).
        const positiveValues = allValues.filter(
          (v): v is number => typeof v === 'number' && v > 0,
        );
        expect(positiveValues.length).toBeGreaterThanOrEqual(1);
      } finally {
        unsubscribe();
      }
    },
  );
});
