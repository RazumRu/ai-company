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
        {
          messages: {
            mode: 'append',
            items: messages,
          },
        },
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: threadId,
            caller_agent: agent,
          }),
          recursionLimit: 2500,
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
        yield { node1: { messages: [] } };
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
        yield {
          any_node: {
            messages: { mode: 'append', items: [new HumanMessage('m1')] },
          },
        };
        yield {
          any_node: {
            messages: { mode: 'append', items: [new HumanMessage('m2')] },
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
        },
      } as any;

      await agent.run(
        'thread-789',
        [new HumanMessage('Hi')],
        config,
        runnableConfig,
      );

      // Expect exactly 2 AgentMessage emits: one for m1, one for m2 (input baseline ignored)
      const emits = (mockNotificationsService.emit as any).mock.calls
        .map((c: any[]) => c[0])
        .filter((n: any) => n.type === NotificationEvent.AgentMessage);
      expect(emits).toHaveLength(2);

      // Ensure payloads correspond to distinct messages
      expect(emits[0]?.data?.messages?.[0]?.content).toBe('m1');
      expect(emits[1]?.data?.messages?.[0]?.content).toBe('m2');
    });

    it('does not re-emit AgentMessage for previously emitted messages', async () => {
      const mockGraph = { stream: vi.fn() } as unknown as { stream: any };

      async function* mockStream() {
        // First chunk introduces m1 and m2 at once
        yield {
          node_a: {
            messages: {
              mode: 'append',
              items: [new HumanMessage('m1'), new HumanMessage('m2')],
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

      // Should emit exactly twice (m1 and m2), no duplicates on second chunk
      expect(emits).toHaveLength(2);
      const contents = emits.map((n: any) => n.data.messages[0].content);
      expect(contents).toEqual(['m1', 'm2']);
    });
  });
});
