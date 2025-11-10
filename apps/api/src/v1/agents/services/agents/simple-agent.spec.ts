import { HumanMessage } from '@langchain/core/messages';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { LoggerModule } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  const _mockNotificationsService = {
    emit: vi.fn(),
  } as unknown as NotificationsService;

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
        maxIterations: 10,
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
        done: false,
        needsMoreInfo: false,
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
      expect(runnable.streamMode).toBe('updates');
      expect(runnable.signal).toBeInstanceOf(AbortSignal);
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
        maxIterations: 10,
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
        maxIterations: 10,
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
        maxIterations: 10,
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
        invokeModelName: 'gpt-5-mini',
        maxIterations: 10,
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
      const { name: _ignored, ...expectedConfig } = newConfig;
      expect(agent['currentConfig']).toEqual(expectedConfig);
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
        invokeModelName: 'gpt-5-mini',
        maxIterations: 10,
      };

      // Ensure no graph exists
      agent['graph'] = undefined;

      // Call setConfig
      agent.setConfig(config);

      // Graph should remain undefined
      expect(agent['graph']).toBeUndefined();
      // Config should be stored
      const { name: _unusedName, ...expectedConfig } = config;
      expect(agent['currentConfig']).toEqual(expectedConfig);
    });
  });
});
