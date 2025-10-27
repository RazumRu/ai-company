import { HumanMessage } from '@langchain/core/messages';
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
}));
vi.mock('@langchain/openai');
vi.mock('@langchain/langgraph');

describe('SimpleAgent', () => {
  let agent: SimpleAgent;
  let mockCheckpointSaver: PgCheckpointSaver;

  beforeEach(async () => {
    mockCheckpointSaver = {
      // Mock checkpoint saver methods
    } as any;

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
          useValue: { emit: vi.fn() },
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
      } as any;

      const initialToolCount = agent['tools'].length;

      agent.addTool(mockTool);

      expect(agent['tools']).toHaveLength(initialToolCount + 1);
      expect(agent['tools']).toContain(mockTool);
    });

    it('should add multiple tools', () => {
      const mockTool1 = { name: 'tool1', invoke: vi.fn() } as any;
      const mockTool2 = { name: 'tool2', invoke: vi.fn() } as any;

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
});
