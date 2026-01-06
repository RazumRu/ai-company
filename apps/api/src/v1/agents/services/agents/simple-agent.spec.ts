import { type AIMessageChunk, HumanMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { Test, TestingModule } from '@nestjs/testing';
import { LoggerModule } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LitellmService } from '../../../litellm/services/litellm.service';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import { NewMessageMode, ReasoningEffort } from '../../agents.types';
import { buildReasoningMessage } from '../../agents.utils';
import { GraphThreadState, IGraphThreadStateData } from '../graph-thread-state';
import { BaseAgentConfigurable } from '../nodes/base-node';
import { PgCheckpointSaver } from '../pg-checkpoint-saver';
import { AgentEventType } from './base-agent';
import { SimpleAgent } from './simple-agent';

// Mock dependencies
vi.mock('@langchain/core/messages', () => ({
  HumanMessage: class MockHumanMessage {
    content: string;
    type: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    additional_kwargs: Record<string, unknown>;
    constructor(content: string) {
      this.content = content;
      this.type = 'human';
      this.additional_kwargs = {};
    }
  },
  ChatMessage: class MockChatMessage {
    content: string;
    type: string;
    role: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    additional_kwargs: Record<string, unknown>;
    constructor(content: string, role: string) {
      this.content = content;
      this.role = role;
      this.type = role;
      this.additional_kwargs = {};
    }
  },
  SystemMessage: class MockSystemMessage {
    content: string;
    type: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    additional_kwargs: Record<string, unknown>;
    constructor(content: string) {
      this.content = content;
      this.type = 'system';
      this.additional_kwargs = {};
    }
  },
}));
vi.mock('@langchain/openai');
vi.mock('@langchain/langgraph');

describe('SimpleAgent', () => {
  let agent: SimpleAgent;
  let mockCheckpointSaver: PgCheckpointSaver;
  const _mockNotificationsService = {
    emit: vi.fn(),
  } as unknown as NotificationsService;
  const setGraphThreadState = (state: GraphThreadState) => {
    const agentRef = agent as unknown as {
      graphThreadState?: GraphThreadState;
      graphThreadStateUnsubscribe?: () => void;
      handleThreadStateChange?: (
        threadId: string,
        nextState: IGraphThreadStateData,
        prevState?: IGraphThreadStateData,
      ) => void;
    };

    agentRef.graphThreadStateUnsubscribe?.();
    agentRef.graphThreadState = state;

    if (typeof agentRef.handleThreadStateChange === 'function') {
      agentRef.graphThreadStateUnsubscribe = state.subscribe(
        agentRef.handleThreadStateChange,
      );
    }
  };

  const waitForMicrotasks = () =>
    new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCheckpointSaver = {
      // Mock checkpoint saver methods
    } as unknown as PgCheckpointSaver;

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          appName: 'test',
          appVersion: '1.0.0',
          environment: 'test',
          prettyPrint: true,
          level: 'debug',
        }),
      ],
      providers: [
        SimpleAgent,
        {
          provide: LitellmService,
          useValue: {
            // SimpleAgent awaits this on every run/runOrAppend; mock it to avoid timeouts.
            attachTokenUsageToMessages: vi.fn().mockResolvedValue(undefined),
          } as unknown as LitellmService,
        },
        {
          provide: PgCheckpointSaver,
          useValue: mockCheckpointSaver,
        },
      ],
    }).compile();

    agent = await module.resolve<SimpleAgent>(SimpleAgent);
  });

  describe('schema', () => {
    it('should have correct schema properties', () => {
      const schema = agent.schema;
      expect(schema).toBeDefined();

      // Test valid configuration
      const validConfig = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
      };

      expect(() => schema.parse(validConfig)).not.toThrow();
    });

    it('should validate required fields', () => {
      const schema = agent.schema;

      const invalidConfig = {
        // missing required fields
      };

      expect(() => schema.parse(invalidConfig)).toThrow();
    });

    it('should validate field types', () => {
      const schema = agent.schema;

      const invalidConfig = {
        summarizeMaxTokens: 'invalid', // should be number
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-5-mini',
      };

      expect(() => schema.parse(invalidConfig)).toThrow();
    });

    it('should have enforceToolUsage field default to undefined when not provided', () => {
      const schema = agent.schema;

      const configWithoutEnforce = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
      };

      const parsed = schema.parse(configWithoutEnforce);
      expect(parsed.enforceToolUsage).toBeUndefined();
    });

    it('should accept enforceToolUsage as boolean', () => {
      const schema = agent.schema;

      const configWithEnforceTrue = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        enforceToolUsage: true,
      };

      const configWithEnforceFalse = {
        ...configWithEnforceTrue,
        enforceToolUsage: false,
      };

      expect(() => schema.parse(configWithEnforceTrue)).not.toThrow();
      expect(() => schema.parse(configWithEnforceFalse)).not.toThrow();

      const parsedTrue = schema.parse(configWithEnforceTrue);
      const parsedFalse = schema.parse(configWithEnforceFalse);

      expect(parsedTrue.enforceToolUsage).toBe(true);
      expect(parsedFalse.enforceToolUsage).toBe(false);
    });

    it('should reject invalid enforceToolUsage type', () => {
      const schema = agent.schema;

      const invalidConfig = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        enforceToolUsage: 'invalid', // should be boolean
      };

      expect(() => schema.parse(invalidConfig)).toThrow();
    });

    it('should default newMessageMode to inject_after_tool_call', () => {
      const schema = agent.schema;
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
      };

      const parsed = schema.parse(config);
      expect(parsed.newMessageMode).toBe('inject_after_tool_call');
    });

    it('should accept newMessageMode values', () => {
      const schema = agent.schema;
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        newMessageMode: 'wait_for_completion',
      };

      expect(() => schema.parse(config)).not.toThrow();
    });
  });

  // (no tests here) message emission de-dupe is handled by correct state seeding in run()

  describe('addTool', () => {
    it('should add tool to tools map', () => {
      const mockTool = {
        name: 'test-tool',
        description: 'Test tool',
        invoke: vi.fn(),
      } as unknown as DynamicStructuredTool;

      const initialToolCount = agent['tools'].size;

      agent.addTool(mockTool);

      expect(agent['tools'].size).toBe(initialToolCount + 1);
      expect(agent['tools'].get(mockTool.name)).toBe(mockTool);
    });

    it('should add multiple tools', () => {
      const mockTool1 = {
        name: 'tool1',
        invoke: vi.fn(),
      } as unknown as DynamicStructuredTool;
      const mockTool2 = {
        name: 'tool2',
        invoke: vi.fn(),
      } as unknown as DynamicStructuredTool;

      const initialToolCount = agent['tools'].size;

      agent.addTool(mockTool1);
      agent.addTool(mockTool2);

      expect(agent['tools'].size).toBe(initialToolCount + 2);
      expect(agent['tools'].get(mockTool1.name)).toBe(mockTool1);
      expect(agent['tools'].get(mockTool2.name)).toBe(mockTool2);
    });
  });

  describe('buildLLM', () => {
    it('should create ChatOpenAI instance with correct configuration', () => {
      // Test that buildLLM method exists and returns something
      const llm = agent.buildLLM('gpt-5-mini');
      expect(llm).toBeDefined();
      expect(typeof llm).toBe('object');
      expect(ChatOpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5-mini',
          useResponsesApi: true,
        }),
      );
    });
  });

  describe('buildState', () => {
    it('should have buildState method available', () => {
      // buildState is a private method, just test that the agent has the method
      expect(typeof agent['buildState']).toBe('function');
    });
  });

  describe('run', () => {
    it('should execute agent with valid configuration', async () => {
      const mockMessages = [new HumanMessage('Response')];

      // Mock async generator for stream
      async function* mockStream() {
        yield [
          'updates',
          {
            'agent-1': {
              messages: {
                mode: 'append',
                items: mockMessages,
              },
            },
          },
        ] as const;
      }

      // Mock the graph compilation and execution
      const mockGraph = {
        stream: vi.fn().mockReturnValue(mockStream()),
      };

      // Mock buildGraph to return our mock graph
      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      const messages = [new HumanMessage('Hello')];
      const threadId = 'test-thread';

      const result = await agent.run(threadId, messages, config);

      expect(agent['buildGraph']).toHaveBeenCalled();
      expect(mockGraph.stream).toHaveBeenCalledTimes(1);
      const [initialState, runnable] = mockGraph.stream.mock.calls[0]!;

      expect(initialState).toMatchObject({
        messages: {
          mode: 'append',
        },
        toolsMetadata: {},
        toolUsageGuardActivated: false,
        toolUsageGuardActivatedCount: 0,
      });
      expect(Array.isArray(initialState.messages.items)).toBe(true);
      expect(initialState.messages.items[0]).toBeInstanceOf(HumanMessage);

      expect(runnable.configurable).toMatchObject({
        thread_id: threadId,
        caller_agent: agent,
      });
      expect(typeof runnable.configurable.run_id).toBe('string');
      expect(runnable.recursionLimit).toBe(config.maxIterations);
      expect(runnable.streamMode).toEqual(['updates', 'messages']);
      expect(runnable.signal).toBeInstanceOf(AbortSignal);
      expect(result).toEqual({
        messages: mockMessages,
        threadId: 'test-thread',
        checkpointNs: undefined,
        needsMoreInfo: false,
      });
    });

    it('should not emit synthetic summary messages when summarize replace shrinks history (scheme A)', async () => {
      const emitSpy = vi.spyOn(agent as any, 'emit');

      const m1 = new HumanMessage('m1');
      const m2 = new HumanMessage('m2');
      const m3 = new HumanMessage('m3');
      for (const m of [m1, m2, m3]) {
        (m as any).additional_kwargs = { __runId: 'run-1' };
      }

      async function* mockStream() {
        yield [
          'updates',
          {
            node1: {
              messages: {
                mode: 'append',
                items: [m1, m2, m3],
              },
            },
          },
        ] as const;

        // Shrink history via replace: old length is 3, new length is 2.
        // Scheme A: summarization never inserts a summary message into history.
        yield [
          'updates',
          {
            summarize: {
              messages: {
                mode: 'replace',
                items: [m3],
              },
            },
          },
        ] as const;
      }

      const mockGraph = {
        stream: vi.fn().mockReturnValue(mockStream()),
      };
      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      await agent.run(
        'thread-summarize-replace',
        [new HumanMessage('Hello')],
        config,
        {
          configurable: { run_id: 'run-1', graph_id: 'graph-1' },
        } as unknown as RunnableConfig<BaseAgentConfigurable>,
      );

      const messageEvents = emitSpy.mock.calls
        .map((c) => c[0] as AgentEventType)
        .filter(
          (e): e is Extract<AgentEventType, { type: 'message' }> =>
            e?.type === 'message',
        );

      const hasSyntheticSummaryMessage = messageEvents.some((e) =>
        e.data.messages.some(
          (m) =>
            typeof (m as any)?.content === 'string' &&
            (m as any).content.startsWith('Conversation summary:\n'),
        ),
      );
      expect(hasSyntheticSummaryMessage).toBe(false);
    });

    it('should handle custom runnable config', async () => {
      async function* mockStream() {
        yield [
          'updates',
          {
            node1: {
              messages: {
                mode: 'append',
                items: [],
              },
            },
          },
        ] as const;
      }

      const mockGraph = {
        stream: vi.fn().mockReturnValue(mockStream()),
      };

      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      const customRunnableConfig = {
        recursionLimit: 1000,
        configurable: { thread_id: 'test-thread', custom: 'value' },
      };

      await agent.run('test-thread', [], config, customRunnableConfig);

      expect(mockGraph.stream).toHaveBeenCalledTimes(1);
      const [, runnable] = mockGraph.stream.mock.calls[0]!;
      expect(runnable.recursionLimit).toBe(
        Math.min(customRunnableConfig.recursionLimit, config.maxIterations),
      );
      expect(runnable.configurable).toMatchObject({
        thread_id: 'test-thread',
        caller_agent: agent,
        custom: 'value',
      });
    });

    it('should handle errors during execution', async () => {
      const mockError = new Error('Graph execution failed');

      async function* mockStream() {
        yield [
          'updates',
          { 'agent-1': { messages: { mode: 'append', items: [] } } },
        ] as const;
        throw mockError;
      }

      const mockGraph = {
        stream: vi.fn().mockReturnValue(mockStream()),
      };

      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      await expect(agent.run('test-thread', [], config)).rejects.toThrow(
        'Graph execution failed',
      );
    });
  });

  describe('runOrAppend', () => {
    const baseConfig = {
      summarizeMaxTokens: 1000,
      summarizeKeepTokens: 500,
      instructions: 'Test instructions',
      name: 'Test Agent',
      description: 'Test agent description',
      invokeModelName: 'gpt-5-mini',
      invokeModelReasoningEffort: ReasoningEffort.None,
      mcpServices: [],
    };

    const buildState = () => ({
      messages: [],
      summary: '',
      toolsMetadata: {},
      toolUsageGuardActivated: false,
      toolUsageGuardActivatedCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      totalPrice: 0,
      currentContext: 0,
    });

    beforeEach(() => {
      agent.setConfig(baseConfig);
      agent['activeRuns'].clear();
    });

    it('should throw when configuration is not set', async () => {
      agent['currentConfig'] = undefined;
      await expect(
        agent.runOrAppend('thread-1', [new HumanMessage('hi')]),
      ).rejects.toThrow('Agent configuration is required for execution');
    });

    it('should start a new run when no active run exists', async () => {
      const runSpy = vi
        .spyOn(agent, 'run')
        .mockResolvedValue(
          {} as unknown as Awaited<ReturnType<SimpleAgent['run']>>,
        );

      await agent.runOrAppend('thread-1', [new HumanMessage('hi')]);

      expect(runSpy).toHaveBeenCalled();
      runSpy.mockRestore();
    });

    it('should append pending messages when inject_after_tool_call', async () => {
      const graphThreadState = new GraphThreadState();
      setGraphThreadState(graphThreadState);

      const runnableConfig = {
        configurable: { run_id: 'run-1', graph_id: 'graph-1' },
      };

      const lastState = buildState();
      agent['activeRuns'].set('run-1', {
        abortController: new AbortController(),
        runnableConfig: runnableConfig as RunnableConfig<BaseAgentConfigurable>,
        threadId: 'thread-1',
        lastState,
      });

      const message = new HumanMessage('Follow-up');
      const result = await agent.runOrAppend('thread-1', [message]);

      const threadState = graphThreadState.getByThread('thread-1');
      expect(threadState.pendingMessages).toHaveLength(1);
      expect(threadState.pendingMessages[0]?.additional_kwargs?.__runId).toBe(
        'run-1',
      );

      expect(result).toEqual({
        messages: lastState.messages,
        threadId: 'thread-1',
        checkpointNs: undefined,
        needsMoreInfo: false,
      });
    });

    it('should keep newMessageMode when mode is wait_for_completion', async () => {
      const graphThreadState = new GraphThreadState();
      setGraphThreadState(graphThreadState);

      graphThreadState.applyForThread('thread-1', {
        pendingMessages: [],
        newMessageMode: NewMessageMode.WaitForCompletion,
      });

      const runnableConfig = {
        configurable: { run_id: 'run-1', graph_id: 'graph-1' },
      };

      agent['activeRuns'].set('run-1', {
        abortController: new AbortController(),
        runnableConfig: runnableConfig as RunnableConfig<BaseAgentConfigurable>,
        threadId: 'thread-1',
        lastState: buildState(),
      });

      await agent.runOrAppend('thread-1', [new HumanMessage('hi')]);

      const threadState = graphThreadState.getByThread('thread-1');
      expect(threadState.pendingMessages).toHaveLength(1);
      expect(threadState.newMessageMode).toBe(NewMessageMode.WaitForCompletion);
    });

    it('should emit nodeAdditionalMetadataUpdate when pending messages change', async () => {
      const graphThreadState = new GraphThreadState();
      setGraphThreadState(graphThreadState);

      const runnableConfig = {
        configurable: { run_id: 'run-1', graph_id: 'graph-1' },
      };

      const lastState = buildState();
      agent['activeRuns'].set('run-1', {
        abortController: new AbortController(),
        runnableConfig: runnableConfig as RunnableConfig<BaseAgentConfigurable>,
        threadId: 'thread-1',
        lastState,
      });

      const emitSpy = vi.spyOn(agent as any, 'emit');

      await agent.runOrAppend('thread-1', [new HumanMessage('Follow-up')]);

      const nodeMetadataEvent = emitSpy.mock.calls
        .map((call) => call[0] as AgentEventType)
        .find(
          (
            event,
          ): event is Extract<
            AgentEventType,
            { type: 'nodeAdditionalMetadataUpdate' }
          > => event?.type === 'nodeAdditionalMetadataUpdate',
        );

      expect(nodeMetadataEvent).toBeDefined();

      if (!nodeMetadataEvent) {
        throw new Error('nodeAdditionalMetadataUpdate event not emitted');
      }

      const additionalMetadata = nodeMetadataEvent.data.additionalMetadata as
        | { pendingMessages?: { content?: string }[] }
        | undefined;

      expect(nodeMetadataEvent).toEqual(
        expect.objectContaining({
          type: 'nodeAdditionalMetadataUpdate',
          data: expect.objectContaining({
            metadata: { threadId: 'thread-1', runId: 'run-1' },
          }),
        }),
      );

      expect(additionalMetadata?.pendingMessages).toBeDefined();
      expect(additionalMetadata?.pendingMessages?.[0]?.content).toBe(
        'Follow-up',
      );
    });
  });

  describe('buildGraph', () => {
    it('should have buildGraph method available', () => {
      // buildGraph is a private method, just test that the agent has the method
      expect(typeof agent['buildGraph']).toBe('function');
    });
  });

  describe('stop', () => {
    it('should handle stop when no active runs exist', async () => {
      // Verify no active runs
      expect(agent['activeRuns'].size).toBe(0);

      // Stop should not throw
      await expect(agent.stop()).resolves.not.toThrow();
    });

    it('should dispose compiled graph and reset cache on stop', async () => {
      await agent.stop();

      expect(agent['graph']).toBeUndefined();
    });

    it('should handle abort errors gracefully during stream processing', async () => {
      const mockGraph = {
        stream: vi.fn(),
      } as unknown as { stream: any };

      async function* mockStream() {
        yield [
          'updates',
          {
            node1: {
              messages: { mode: 'append', items: [] },
            },
          },
        ] as const;
        await new Promise((resolve) => setTimeout(resolve, 50));
        // Simulate abort error
        const error = new Error('The operation was aborted');
        (error as any).name = 'AbortError';
        throw error;
      }

      mockGraph.stream = vi.fn().mockImplementation((_state) => {
        // Get the abort controller from the agent's active runs and abort it
        // This simulates what happens when stop() is called
        setTimeout(() => {
          const activeRuns = agent['activeRuns'];
          for (const run of activeRuns.values()) {
            run.abortController.abort();
          }
        }, 10);
        return mockStream();
      });

      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      // Run should complete without throwing (abort error is swallowed)
      const result = await agent.run(
        'thread-789',
        [new HumanMessage('Hello')],
        config,
      );

      expect(result).toBeDefined();
      expect(agent['activeRuns'].size).toBe(0);
    });
  });

  describe('setConfig', () => {
    it('should update configuration and clear graph', () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      // Simulate a graph being built
      agent['graph'] = {} as any;
      agent['currentConfig'] = config;

      const newConfig = {
        ...config,
        instructions: 'Updated instructions',
      };

      // Call setConfig
      agent.setConfig(newConfig);

      // Graph should be cleared for rebuild
      expect(agent['graph']).toBeUndefined();
      // New config should be stored
      expect(agent['currentConfig']).toEqual({
        ...newConfig,
        newMessageMode: NewMessageMode.InjectAfterToolCall,
      });
    });

    it('should validate config before setting', () => {
      const invalidConfig = {
        summarizeMaxTokens: 'invalid', // should be number
      };

      expect(() => agent.setConfig(invalidConfig as any)).toThrow();
    });

    it('should clear graph even when no graph exists', () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      // Ensure no graph exists
      agent['graph'] = undefined;

      // Call setConfig
      agent.setConfig(config);

      // Graph should remain undefined
      expect(agent['graph']).toBeUndefined();
      // Config should be stored
      expect(agent['currentConfig']).toEqual({
        ...config,
        newMessageMode: NewMessageMode.InjectAfterToolCall,
      });
    });
  });

  describe('getGraphNodeMetadata', () => {
    it('should return undefined when no graph thread state is set', () => {
      const metadata = agent.getGraphNodeMetadata({ threadId: 'thread-1' });
      // When no config is set, metadata should be undefined or only contain connectedTools
      if (metadata) {
        expect(metadata).toEqual({ connectedTools: [] });
      } else {
        expect(metadata).toBeUndefined();
      }
    });

    it('should return instructions when configured even without thread state', () => {
      agent.setConfig({
        name: 'Test Agent',
        description: 'Test agent description',
        instructions: 'Follow these steps',
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
      });

      const metadata = agent.getGraphNodeMetadata({});

      expect(metadata).toEqual({
        instructions: 'Follow these steps',
        connectedTools: [],
      });
    });

    it('should return empty pending messages when there are no pending messages', () => {
      agent.setConfig({
        name: 'Test Agent',
        description: 'Test agent description',
        instructions: 'Agent instructions',
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
      });

      const threadState = new GraphThreadState();
      setGraphThreadState(threadState);

      const metadata = agent.getGraphNodeMetadata({ threadId: 'thread-1' });
      expect(metadata).toEqual({
        pendingMessages: [],
        reasoningChunks: {},
        instructions: 'Agent instructions',
        connectedTools: [],
      });
    });

    it('should return pending messages for a thread', () => {
      agent.setConfig({
        name: 'Test Agent',
        description: 'Test agent description',
        instructions: 'Agent instructions',
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
      });

      const threadState = new GraphThreadState();
      setGraphThreadState(threadState);

      const message = new HumanMessage('pending');
      threadState.applyForThread('thread-1', { pendingMessages: [message] });

      const metadata = agent.getGraphNodeMetadata({ threadId: 'thread-1' });

      expect(metadata).toEqual({
        pendingMessages: [
          {
            content: 'pending',
            role: 'human',
            additionalKwargs: {},
          },
        ],
        reasoningChunks: {},
        instructions: 'Agent instructions',
        connectedTools: [],
      });
    });
  });

  describe('reasoning metadata handling', () => {
    const threadId = 'thread-reasoning';
    const runId = 'run-reasoning';

    const buildLastState = () => ({
      messages: [],
      summary: '',
      toolsMetadata: {},
      toolUsageGuardActivated: false,
      toolUsageGuardActivatedCount: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      totalPrice: 0,
      currentContext: 0,
    });

    const registerActiveRun = () => {
      agent['activeRuns'].set(runId, {
        abortController: new AbortController(),
        runnableConfig: {
          configurable: { run_id: runId, graph_id: 'graph-1' },
        } as RunnableConfig<BaseAgentConfigurable>,
        threadId,
        lastState: buildLastState(),
      });
    };

    afterEach(() => {
      agent['activeRuns'].clear();
    });

    it('should emit node metadata updates when reasoning chunks change', async () => {
      const graphThreadState = new GraphThreadState();
      setGraphThreadState(graphThreadState);
      registerActiveRun();

      const events: AgentEventType[] = [];
      const unsubscribe = agent.subscribe(async (event) => {
        events.push(event);
      });

      const reasoningMessage = buildReasoningMessage(
        'planning step',
        'message-1',
      );

      if (!reasoningMessage.id) {
        throw new Error('Reasoning message id missing');
      }

      graphThreadState.applyForThread(threadId, {
        reasoningChunks: new Map([[reasoningMessage.id, reasoningMessage]]),
      });

      await waitForMicrotasks();

      const metadataEvent = events
        .filter(
          (
            event,
          ): event is Extract<
            AgentEventType,
            { type: 'nodeAdditionalMetadataUpdate' }
          > => event.type === 'nodeAdditionalMetadataUpdate',
        )
        .at(-1);

      expect(metadataEvent).toBeDefined();
      expect(metadataEvent?.data.additionalMetadata?.reasoningChunks).toEqual(
        expect.objectContaining({
          [reasoningMessage.id]: expect.objectContaining({
            id: reasoningMessage.id,
            content: reasoningMessage.content,
          }),
        }),
      );

      unsubscribe();
    });

    it('should clear reasoning state and notify subscribers', async () => {
      const graphThreadState = new GraphThreadState();
      setGraphThreadState(graphThreadState);
      registerActiveRun();

      const reasoningMessage = buildReasoningMessage(
        'cleanup step',
        'message-2',
      );

      if (!reasoningMessage.id) {
        throw new Error('Reasoning message id missing');
      }

      graphThreadState.applyForThread(threadId, {
        reasoningChunks: new Map([[reasoningMessage.id, reasoningMessage]]),
      });

      const events: AgentEventType[] = [];
      const unsubscribe = agent.subscribe(async (event) => {
        events.push(event);
      });

      events.length = 0;

      (agent as any).clearReasoningState(threadId);

      await waitForMicrotasks();

      const state = graphThreadState.getByThread(threadId);
      expect(state.reasoningChunks.size).toBe(0);

      const metadataEvent = events
        .filter(
          (
            event,
          ): event is Extract<
            AgentEventType,
            { type: 'nodeAdditionalMetadataUpdate' }
          > => event.type === 'nodeAdditionalMetadataUpdate',
        )
        .at(-1);

      expect(metadataEvent).toBeDefined();
      expect(metadataEvent?.data.additionalMetadata?.reasoningChunks).toEqual(
        {},
      );

      unsubscribe();
    });

    it('should align reasoning message ids between notifications and message stream', () => {
      const graphThreadState = new GraphThreadState();
      setGraphThreadState(graphThreadState);

      const reasoningChunk = {
        id: 'chunk-123',
        contentBlocks: [
          {
            type: 'reasoning',
            reasoning: 'step 1',
          },
        ],
        response_metadata: {},
      } as AIMessageChunk;

      (agent as any).handleReasoningChunk(threadId, reasoningChunk);

      const metadata = agent.getGraphNodeMetadata({ threadId });
      const reasoningMetadata = metadata?.reasoningChunks as
        | Record<string, { id: string }>
        | undefined;

      const metadataEntry = reasoningMetadata?.['reasoning:chunk-123'];
      expect(metadataEntry).toBeDefined();

      const reasoningMessage = buildReasoningMessage('step 1', 'chunk-123');
      expect(metadataEntry?.id).toBe(reasoningMessage.id);
      expect(reasoningMessage.id).toBe('reasoning:chunk-123');
    });
  });

  describe('nodeAdditionalMetadataUpdate events', () => {
    beforeEach(() => {
      agent.setConfig({
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
      });
    });

    it('should emit event even when pending metadata is empty', () => {
      const emitSpy = vi.spyOn(agent as any, 'emit');
      setGraphThreadState(new GraphThreadState());

      (agent as any).emitNodeAdditionalMetadataUpdate({
        threadId: 'thread-1',
      });

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'nodeAdditionalMetadataUpdate',
          data: {
            metadata: { threadId: 'thread-1' },
            additionalMetadata: {
              pendingMessages: [],
              reasoningChunks: {},
              instructions: 'Test instructions',
              connectedTools: [],
            },
          },
        }),
      );
    });
  });
});
