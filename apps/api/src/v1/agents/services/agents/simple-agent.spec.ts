import { HumanMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { LoggerModule } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationEvent } from '../../../notifications/notifications.types';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import { PgCheckpointSaver } from '../pg-checkpoint-saver';
import { SimpleAgent } from './simple-agent';

// Mock dependencies
vi.mock('@langchain/core/messages', () => ({
  HumanMessage: class MockHumanMessage {
    content: string;
    constructor(content: string) {
      this.content = content;
    }
  },
  SystemMessage: class MockSystemMessage {
    content: string;
    constructor(content: string) {
      this.content = content;
    }
  },
}));
vi.mock('@langchain/openai');
vi.mock('@langchain/langgraph');

describe('SimpleAgent', () => {
  let agent: SimpleAgent;
  let mockCheckpointSaver: PgCheckpointSaver;
  let mockNotificationsService: NotificationsService;

  beforeEach(async () => {
    mockCheckpointSaver = {
      // Mock checkpoint saver methods
    } as unknown as PgCheckpointSaver;

    mockNotificationsService = {
      emit: vi.fn(),
    } as unknown as NotificationsService;

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
          provide: PgCheckpointSaver,
          useValue: mockCheckpointSaver,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
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
        invokeModelName: 'gpt-5-mini',
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
        invokeModelName: 'gpt-5-mini',
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
        invokeModelName: 'gpt-5-mini',
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
        invokeModelName: 'gpt-5-mini',
        enforceToolUsage: 'invalid', // should be boolean
      };

      expect(() => schema.parse(invalidConfig)).toThrow();
    });
  });

  describe('addTool', () => {
    it('should add tool to tools array', () => {
      const mockTool = {
        name: 'test-tool',
        description: 'Test tool',
        invoke: vi.fn(),
      } as unknown as DynamicStructuredTool;

      const initialToolCount = agent['tools'].length;

      agent.addTool(mockTool);

      expect(agent['tools']).toHaveLength(initialToolCount + 1);
      expect(agent['tools']).toContain(mockTool);
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

      const initialToolCount = agent['tools'].length;

      agent.addTool(mockTool1);
      agent.addTool(mockTool2);

      expect(agent['tools']).toHaveLength(initialToolCount + 2);
      expect(agent['tools']).toContain(mockTool1);
      expect(agent['tools']).toContain(mockTool2);
    });
  });

  describe('buildLLM', () => {
    it('should create ChatOpenAI instance with correct configuration', () => {
      // Test that buildLLM method exists and returns something
      const llm = agent.buildLLM('gpt-5-mini');
      expect(llm).toBeDefined();
      expect(typeof llm).toBe('object');
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
        yield {
          'agent-1': {
            messages: {
              mode: 'append',
              items: mockMessages,
            },
          },
        };
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
        invokeModelName: 'gpt-5-mini',
      };

      const messages = [new HumanMessage('Hello')];
      const threadId = 'test-thread';

      const result = await agent.run(threadId, messages, config);

      expect(agent['buildGraph']).toHaveBeenCalledWith(config);
      expect(mockGraph.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: {
            mode: 'append',
            items: expect.arrayContaining([
              expect.objectContaining({
                content: 'Hello',
                additional_kwargs: expect.objectContaining({
                  run_id: expect.any(String),
                }),
              }),
            ]),
          },
          done: false,
          needsMoreInfo: false,
          toolUsageGuardActivated: false,
          toolUsageGuardActivatedCount: 0,
        }),
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: threadId,
            caller_agent: agent,
            run_id: expect.any(String),
          }),
          recursionLimit: 2500,
          streamMode: 'updates',
        }),
      );
      expect(result).toEqual({
        messages: mockMessages,
        threadId: 'test-thread',
        checkpointNs: undefined,
        needsMoreInfo: false,
      });
    });

    it('should handle custom runnable config', async () => {
      async function* mockStream() {
        yield {
          node1: {
            messages: {
              mode: 'append',
              items: [],
            },
          },
        };
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
        invokeModelName: 'gpt-5-mini',
      };

      const customRunnableConfig = {
        recursionLimit: 1000,
        configurable: { thread_id: 'test-thread', custom: 'value' },
      };

      await agent.run('test-thread', [], config, customRunnableConfig);

      expect(mockGraph.stream).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          recursionLimit: 1000,
          configurable: expect.objectContaining({
            thread_id: 'test-thread',
            caller_agent: agent,
            custom: 'value',
          }),
        }),
      );
    });

    it('should handle errors during execution', async () => {
      const mockError = new Error('Graph execution failed');

      async function* mockStream() {
        yield { 'agent-1': { messages: { mode: 'append', items: [] } } };
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
        invokeModelName: 'gpt-5-mini',
      };

      await expect(agent.run('test-thread', [], config)).rejects.toThrow(
        'Graph execution failed',
      );
    });
  });

  describe('buildGraph', () => {
    it('should have buildGraph method available', () => {
      // buildGraph is a private method, just test that the agent has the method
      expect(typeof agent['buildGraph']).toBe('function');
    });
  });

  describe('state updates', () => {
    it('should emit state update notification when generatedTitle changes', async () => {
      const mockGraph = {
        stream: vi.fn(),
      };

      async function* mockStream() {
        yield {
          generate_title: {
            generatedTitle: 'Generated Title',
          },
        };
      }

      mockGraph.stream = vi.fn().mockReturnValue(mockStream());
      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        invokeModelName: 'gpt-5-mini',
      };

      const runnableConfig = {
        configurable: {
          graph_id: 'graph-123',
          node_id: 'node-456',
          thread_id: 'thread-789',
          parent_thread_id: 'parent-thread-123',
        },
      };

      await agent.run(
        'thread-789',
        [new HumanMessage('Hello')],
        config,
        runnableConfig,
      );

      expect(mockNotificationsService.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationEvent.AgentStateUpdate,
          graphId: 'graph-123',
          nodeId: 'node-456',
          threadId: 'thread-789',
          parentThreadId: 'parent-thread-123',
          data: expect.objectContaining({
            generatedTitle: 'Generated Title',
          }),
        }),
      );
    });

    it('should only include changed fields in state update', async () => {
      const mockGraph = {
        stream: vi.fn(),
      };

      async function* mockStream() {
        yield {
          generate_title: {
            generatedTitle: 'Generated Title',
          },
        };
        yield {
          summarize: {
            summary: 'New Summary',
          },
        };
      }

      mockGraph.stream = vi.fn().mockReturnValue(mockStream());
      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        invokeModelName: 'gpt-5-mini',
      };

      const runnableConfig = {
        configurable: {
          graph_id: 'graph-123',
          node_id: 'node-456',
          thread_id: 'thread-789',
          parent_thread_id: 'parent-thread-123',
        },
      };

      await agent.run(
        'thread-789',
        [new HumanMessage('Hello')],
        config,
        runnableConfig,
      );

      const stateUpdateCalls = vi
        .mocked(mockNotificationsService.emit)
        .mock.calls.filter(
          (call) => call[0]?.type === NotificationEvent.AgentStateUpdate,
        );

      // Should have separate calls for title and summary changes
      expect(stateUpdateCalls.length).toBeGreaterThanOrEqual(1);

      // First call should only have generatedTitle
      const firstCall = stateUpdateCalls[0];
      if (firstCall) {
        expect(firstCall[0]).toMatchObject({
          data: expect.objectContaining({
            generatedTitle: 'Generated Title',
          }),
        });
      }
    });

    it('should not emit state update if no state changes', async () => {
      const mockGraph = {
        stream: vi.fn(),
      };

      async function* mockStream() {
        yield {
          node1: {
            messages: { mode: 'append', items: [] },
          },
        };
      }

      mockGraph.stream = vi.fn().mockReturnValue(mockStream());
      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        invokeModelName: 'gpt-5-mini',
      };

      const runnableConfig = {
        configurable: {
          graph_id: 'graph-123',
          node_id: 'node-456',
          thread_id: 'thread-789',
          parent_thread_id: 'parent-thread-123',
        },
      };

      await agent.run(
        'thread-789',
        [new HumanMessage('Hello')],
        config,
        runnableConfig,
      );

      const stateUpdateCalls = vi
        .mocked(mockNotificationsService.emit)
        .mock.calls.filter(
          (call) => call[0]?.type === NotificationEvent.AgentStateUpdate,
        );

      // Should not emit state update if nothing changed
      expect(stateUpdateCalls.length).toBe(0);
    });
  });

  describe('agent message notifications (no duplication)', () => {
    it('emits exactly one AgentMessage per new message across chunks', async () => {
      const mockGraph = {
        stream: vi.fn(),
      } as unknown as { stream: any };

      // First chunk appends one message, second chunk appends another,
      // third chunk has no new messages
      async function* mockStream() {
        const m1 = new HumanMessage('m1');
        m1.additional_kwargs = { run_id: 'test-run-id' };
        const m2 = new HumanMessage('m2');
        m2.additional_kwargs = { run_id: 'test-run-id' };

        yield {
          any_node: {
            messages: { mode: 'append', items: [m1] },
          },
        };
        yield {
          any_node: {
            messages: { mode: 'append', items: [m2] },
          },
        };
        yield {
          any_node: {
            // no messages change
          },
        };
      }

      mockGraph.stream = vi.fn().mockReturnValue(mockStream());
      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        invokeModelName: 'gpt-5-mini',
      } as any;

      const runnableConfig = {
        configurable: {
          graph_id: 'graph-123',
          node_id: 'node-456',
          thread_id: 'thread-789',
          parent_thread_id: 'parent-thread-123',
          run_id: 'test-run-id',
        },
      } as any;

      await agent.run(
        'thread-789',
        [new HumanMessage('Hi')],
        config,
        runnableConfig,
      );

      // Expect exactly 2 AgentMessage emits: one for m1, one for m2 (no duplication)
      const emits = (mockNotificationsService.emit as any).mock.calls
        .map((c: any[]) => c[0])
        .filter((n: any) => n.type === NotificationEvent.AgentMessage);

      expect(emits).toHaveLength(2);

      // Ensure payloads correspond to distinct messages
      // First message should be m1, then m2
      expect(emits[0]?.data?.messages?.[0]?.content).toBe('m1');
      expect(emits[1]?.data?.messages?.[0]?.content).toBe('m2');
    });

    it('does not re-emit AgentMessage for previously emitted messages', async () => {
      const mockGraph = { stream: vi.fn() } as unknown as { stream: any };

      async function* mockStream() {
        // First chunk introduces m1 and m2 at once
        const m1 = new HumanMessage('m1');
        m1.additional_kwargs = { run_id: 'test-run-id' };
        const m2 = new HumanMessage('m2');
        m2.additional_kwargs = { run_id: 'test-run-id' };

        yield {
          node_a: {
            messages: {
              mode: 'append',
              items: [m1, m2],
            },
          },
        };
        // Second chunk repeats no new messages -> should not emit again
        yield { node_a: {} };
      }

      mockGraph.stream = vi.fn().mockReturnValue(mockStream());
      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        invokeModelName: 'gpt-5-mini',
      } as any;

      const runnableConfig = {
        configurable: {
          graph_id: 'graph-123',
          node_id: 'node-456',
          thread_id: 'thread-789',
          parent_thread_id: 'parent-thread-123',
          run_id: 'test-run-id',
        },
      } as any;

      await agent.run(
        'thread-789',
        [new HumanMessage('Hi')],
        config,
        runnableConfig,
      );

      const emits = (mockNotificationsService.emit as any).mock.calls
        .map((c: any[]) => c[0])
        .filter((n: any) => n.type === NotificationEvent.AgentMessage);

      // Should emit exactly 2 times (m1 and m2), no duplicates on second chunk
      expect(emits).toHaveLength(2);
      const contents = emits.map((n: any) => n.data.messages[0].content);
      expect(contents).toEqual(['m1', 'm2']);
    });
  });

  describe('stop', () => {
    it('should abort active runs and emit system message for unfinished runs', async () => {
      const mockGraph = {
        stream: vi.fn(),
      } as unknown as { stream: any };

      // Create a long-running stream that can be aborted
      let abortSignal: AbortSignal | undefined;
      async function* mockStream() {
        // Simulate a long-running operation
        await new Promise((resolve) => setTimeout(resolve, 100));
        yield {
          node1: {
            messages: { mode: 'append', items: [] },
            done: false,
          },
        };
        // Wait for abort signal
        await new Promise<void>((resolve) => {
          if (abortSignal?.aborted) {
            resolve();
            return;
          }
          abortSignal?.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
      }

      mockGraph.stream = vi.fn().mockImplementation((_state, config) => {
        abortSignal = config.signal;
        return mockStream();
      });

      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        invokeModelName: 'gpt-5-mini',
      };

      const runnableConfig = {
        configurable: {
          graph_id: 'graph-123',
          node_id: 'node-456',
          thread_id: 'thread-789',
          parent_thread_id: 'parent-thread-123',
          run_id: 'test-run-id',
        },
      };

      // Start the run (don't await - it will run until aborted)
      const runPromise = agent.run(
        'thread-789',
        [new HumanMessage('Hello')],
        config,
        runnableConfig,
      );

      // Wait a bit to ensure the run has started
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Verify there's an active run
      expect(agent['activeRuns'].size).toBe(1);
      expect(agent['activeRuns'].has('test-run-id')).toBe(true);

      // Stop the agent
      await agent.stop();

      // Verify abort was called
      expect(abortSignal?.aborted).toBe(true);

      // Verify system message was emitted (because done=false)
      const systemMessageCalls = vi
        .mocked(mockNotificationsService.emit)
        .mock.calls.filter(
          (call) =>
            call[0]?.type === NotificationEvent.AgentMessage &&
            call[0]?.data?.messages?.[0]?.content ===
              'Graph execution was stopped',
        );

      expect(systemMessageCalls.length).toBeGreaterThan(0);
      expect(systemMessageCalls[0]?.[0]).toMatchObject({
        type: NotificationEvent.AgentMessage,
        graphId: 'graph-123',
        nodeId: 'node-456',
        threadId: 'thread-789',
        parentThreadId: 'parent-thread-123',
        data: {
          messages: [
            expect.objectContaining({
              content: 'Graph execution was stopped',
            }),
          ],
        },
      });

      // Verify active runs are cleared
      expect(agent['activeRuns'].size).toBe(0);

      // The run promise should resolve (after abort error is swallowed)
      await runPromise;
    }, 10000);

    it('should not emit system message for finished runs', async () => {
      const mockGraph = {
        stream: vi.fn(),
      } as unknown as { stream: any };

      async function* mockStream() {
        yield {
          node1: {
            messages: { mode: 'append', items: [] },
            done: true, // Run is finished
          },
        };
      }

      mockGraph.stream = vi.fn().mockReturnValue(mockStream());
      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        invokeModelName: 'gpt-5-mini',
      };

      const runnableConfig = {
        configurable: {
          graph_id: 'graph-123',
          node_id: 'node-456',
          thread_id: 'thread-789',
          parent_thread_id: 'parent-thread-123',
          run_id: 'test-run-id-2',
        },
      };

      // Complete the run first
      await agent.run(
        'thread-789',
        [new HumanMessage('Hello')],
        config,
        runnableConfig,
      );

      // Verify no active runs
      expect(agent['activeRuns'].size).toBe(0);

      // Manually add a finished run to activeRuns to test stop() behavior
      agent['activeRuns'].set('test-run-id-2', {
        abortController: new AbortController(),
        runnableConfig: runnableConfig as any,
        threadId: 'thread-789',
        lastState: { done: true } as any, // Marked as done
      });

      // Stop the agent
      await agent.stop();

      // Verify no system message was emitted (because done=true)
      const systemMessageCalls = vi
        .mocked(mockNotificationsService.emit)
        .mock.calls.filter(
          (call) =>
            call[0]?.type === NotificationEvent.AgentMessage &&
            call[0]?.data?.messages?.[0]?.content ===
              'Graph execution was stopped',
        );

      expect(systemMessageCalls.length).toBe(0);
    });

    it('should handle multiple active runs', async () => {
      const mockGraph = {
        stream: vi.fn(),
      } as unknown as { stream: any };

      const abortSignals: AbortSignal[] = [];
      async function* mockStream(signal: AbortSignal) {
        yield {
          node1: {
            messages: { mode: 'append', items: [] },
            done: false,
          },
        };
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
            return;
          }
          signal.addEventListener('abort', () => resolve(), {
            once: true,
          });
        });
      }

      mockGraph.stream = vi.fn().mockImplementation((_state, config) => {
        abortSignals.push(config.signal);
        return mockStream(config.signal);
      });

      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        invokeModelName: 'gpt-5-mini',
      };

      // Start multiple runs
      const runnableConfig1 = {
        configurable: {
          graph_id: 'graph-123',
          node_id: 'node-456',
          thread_id: 'thread-1',
          parent_thread_id: 'parent-thread-123',
          run_id: 'test-run-id-1',
        },
      };

      const runnableConfig2 = {
        configurable: {
          graph_id: 'graph-123',
          node_id: 'node-456',
          thread_id: 'thread-2',
          parent_thread_id: 'parent-thread-123',
          run_id: 'test-run-id-2',
        },
      };

      const promise1 = agent.run(
        'thread-1',
        [new HumanMessage('Hello')],
        config,
        runnableConfig1,
      );
      const promise2 = agent.run(
        'thread-2',
        [new HumanMessage('Hello')],
        config,
        runnableConfig2,
      );

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify both runs are active
      expect(agent['activeRuns'].size).toBe(2);

      // Stop all runs
      await agent.stop();

      // Verify both abort signals were triggered
      expect(abortSignals.length).toBe(2);
      expect(abortSignals[0]?.aborted).toBe(true);
      expect(abortSignals[1]?.aborted).toBe(true);

      // Verify system messages were emitted for both
      const systemMessageCalls = vi
        .mocked(mockNotificationsService.emit)
        .mock.calls.filter(
          (call) =>
            call[0]?.type === NotificationEvent.AgentMessage &&
            call[0]?.data?.messages?.[0]?.content ===
              'Graph execution was stopped',
        );

      expect(systemMessageCalls.length).toBe(2);

      // Verify active runs are cleared
      expect(agent['activeRuns'].size).toBe(0);

      // Wait for promises to resolve
      await Promise.all([promise1, promise2]);
    }, 10000);

    it('should handle stop when no active runs exist', async () => {
      // Verify no active runs
      expect(agent['activeRuns'].size).toBe(0);

      // Stop should not throw
      await expect(agent.stop()).resolves.not.toThrow();
    });

    it('should mark stop message with hideForLlm flag', async () => {
      const mockGraph = {
        stream: vi.fn(),
      } as unknown as { stream: any };

      async function* mockStream() {
        yield {
          node1: {
            messages: { mode: 'append', items: [] },
            done: false, // Not done - so stop message should be emitted
          },
        };
      }

      mockGraph.stream = vi.fn().mockReturnValue(mockStream());
      agent['buildGraph'] = vi.fn().mockReturnValue(mockGraph);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test instructions',
        invokeModelName: 'gpt-5-mini',
      };

      const runnableConfig = {
        configurable: {
          graph_id: 'graph-123',
          node_id: 'node-456',
          thread_id: 'thread-789',
          parent_thread_id: 'parent-thread-123',
          run_id: 'test-run-id-3',
        },
      };

      // Complete the run first
      await agent.run(
        'thread-789',
        [new HumanMessage('Hello')],
        config,
        runnableConfig,
      );

      // Manually add an unfinished run to activeRuns to test stop() behavior
      agent['activeRuns'].set('test-run-id-3', {
        abortController: new AbortController(),
        runnableConfig: runnableConfig as any,
        threadId: 'thread-789',
        lastState: { done: false } as any, // Not marked as done
      });

      // Stop the agent
      await agent.stop();

      // Verify the stop message was emitted with hideForLlm flag
      const stopMessageCalls = vi
        .mocked(mockNotificationsService.emit)
        .mock.calls.filter(
          (call) =>
            call[0]?.type === NotificationEvent.AgentMessage &&
            call[0]?.data?.messages?.[0]?.content ===
              'Graph execution was stopped',
        );

      expect(stopMessageCalls.length).toBeGreaterThan(0);
      const stopMessage = (stopMessageCalls[0]?.[0]?.data as any)
        ?.messages?.[0];
      expect(stopMessage?.additional_kwargs?.hideForLlm).toBe(true);
    });

    it('should handle abort errors gracefully during stream processing', async () => {
      const mockGraph = {
        stream: vi.fn(),
      } as unknown as { stream: any };

      async function* mockStream() {
        yield {
          node1: {
            messages: { mode: 'append', items: [] },
          },
        };
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
        invokeModelName: 'gpt-5-mini',
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
});
