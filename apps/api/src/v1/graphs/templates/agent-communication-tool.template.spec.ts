import { HumanMessage } from '@langchain/core/messages';
import {
  DynamicStructuredTool,
  ToolRunnableConfig,
} from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCommunicationTool } from '../../agent-tools/tools/agent-communication.tool';
import { AgentOutput } from '../../agents/services/agents/base-agent';
import { BaseAgentConfigurable } from '../../agents/services/nodes/base-node';
import { CompiledGraphNode, NodeKind } from '../graphs.types';
import {
  AgentCommunicationToolTemplate,
  AgentCommunicationToolTemplateSchema,
} from './agent-communication-tool.template';
import { SimpleAgentTemplateResult } from './base-node.template';
import { SimpleAgentTemplateSchemaType } from './simple-agent.template';

describe('AgentCommunicationToolTemplate', () => {
  let template: AgentCommunicationToolTemplate;
  let mockAgentCommunicationTool: AgentCommunicationTool;

  beforeEach(async () => {
    mockAgentCommunicationTool = {
      build: vi.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentCommunicationToolTemplate,
        {
          provide: AgentCommunicationTool,
          useValue: mockAgentCommunicationTool,
        },
      ],
    }).compile();

    template = module.get<AgentCommunicationToolTemplate>(
      AgentCommunicationToolTemplate,
    );
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('agent-communication-tool');
    });

    it('should have correct description', () => {
      expect(template.description).toBe(
        'Allows an agent to initiate communication with another agent via an internal request pipeline.',
      );
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.Tool);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(AgentCommunicationToolTemplateSchema);
    });
  });

  describe('schema validation', () => {
    it('should validate required agentId', () => {
      const validConfig = {
        agentId: 'target-agent-1',
      };

      expect(() =>
        AgentCommunicationToolTemplateSchema.parse(validConfig),
      ).not.toThrow();
    });

    it('should reject missing agentId', () => {
      const invalidConfig = {};

      expect(() =>
        AgentCommunicationToolTemplateSchema.parse(invalidConfig),
      ).toThrow();
    });

    it('should reject empty agentId', () => {
      const invalidConfig = {
        agentId: '',
      };

      expect(() =>
        AgentCommunicationToolTemplateSchema.parse(invalidConfig),
      ).toThrow();
    });

    it('should validate optional metadata', () => {
      const validConfig = {
        agentId: 'target-agent-1',
        metadata: {
          priority: 'high',
          timeout: 30000,
          retries: 3,
        },
      };

      expect(() =>
        AgentCommunicationToolTemplateSchema.parse(validConfig),
      ).not.toThrow();
    });
  });

  describe('create', () => {
    let mockAgent: any;
    let mockAgentNode: CompiledGraphNode<
      SimpleAgentTemplateResult<SimpleAgentTemplateSchemaType>
    >;
    let compiledNodes: Map<string, CompiledGraphNode>;

    beforeEach(() => {
      mockAgent = {
        run: vi.fn().mockResolvedValue({
          messages: [new HumanMessage('Agent response')],
        }),
      };

      const mockAgentResult: SimpleAgentTemplateResult<SimpleAgentTemplateSchemaType> =
        {
          agent: mockAgent,
          config: {
            summarizeMaxTokens: 1000,
            summarizeKeepTokens: 500,
            instructions: 'Test agent instructions',
            name: 'Test Agent',
            invokeModelName: 'gpt-4',
          },
        };

      mockAgentNode = {
        id: 'target-agent-1',
        type: 'simpleAgent',
        instance: mockAgentResult,
      };

      compiledNodes = new Map([['target-agent-1', mockAgentNode]]);
    });

    it('should create agent communication tool with valid agent node', async () => {
      const mockTool = { name: 'agent-communication' } as DynamicStructuredTool;
      mockAgentCommunicationTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {
        agentId: 'target-agent-1',
      };

      const result = await template.create(config, compiledNodes);

      expect(mockAgentCommunicationTool.build).toHaveBeenCalledWith({
        invokeAgent: expect.any(Function),
      });
      expect(result).toBe(mockTool);
    });

    it('should throw NotFoundException when agent node not found', async () => {
      const emptyCompiledNodes = new Map();

      const config = {
        agentId: 'non-existent-agent',
      };

      await expect(template.create(config, emptyCompiledNodes)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException with correct error message', async () => {
      const emptyCompiledNodes = new Map();

      const config = {
        agentId: 'missing-agent',
      };

      try {
        await template.create(config, emptyCompiledNodes);
        fail('Expected NotFoundException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toContain('Agent node missing-agent not found');
      }
    });

    it('should create invokeAgent function that calls target agent correctly', async () => {
      let capturedInvokeAgent: any;
      mockAgentCommunicationTool.build = vi
        .fn()
        .mockImplementation((options) => {
          capturedInvokeAgent = options.invokeAgent;
          return { name: 'agent-communication' } as DynamicStructuredTool;
        });

      const config = {
        agentId: 'target-agent-1',
      };

      await template.create(config, compiledNodes);

      // Test the captured invokeAgent function
      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'parent-thread-123' },
      } as any;

      const messages = ['Hello', 'How are you?'];
      const childThreadId = 'child-conversation-1';

      const result = await capturedInvokeAgent(
        messages,
        childThreadId,
        mockRunnableConfig,
      );

      expect(mockAgent.run).toHaveBeenCalledWith(
        'parent-thread-123__child-conversation-1',
        [new HumanMessage('Hello'), new HumanMessage('How are you?')],
        mockAgentNode.instance.config,
        mockRunnableConfig,
      );
      expect(result).toEqual({
        messages: [new HumanMessage('Agent response')],
      });
    });

    it('should handle missing thread_id in runnableConfig', async () => {
      let capturedInvokeAgent: any;
      mockAgentCommunicationTool.build = vi
        .fn()
        .mockImplementation((options) => {
          capturedInvokeAgent = options.invokeAgent;
          return { name: 'agent-communication' } as DynamicStructuredTool;
        });

      const config = {
        agentId: 'target-agent-1',
      };

      await template.create(config, compiledNodes);

      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: {},
      } as any;

      const messages = ['Test message'];
      const childThreadId = 'child-1';

      await capturedInvokeAgent(messages, childThreadId, mockRunnableConfig);

      // Should generate a fallback thread ID
      expect(mockAgent.run).toHaveBeenCalledWith(
        expect.stringMatching(/^inter-agent-\d+__child-1$/),
        [new HumanMessage('Test message')],
        mockAgentNode.instance.config,
        mockRunnableConfig,
      );
    });

    it('should throw NotFoundException when target agent not found during invocation', async () => {
      let capturedInvokeAgent: any;
      mockAgentCommunicationTool.build = vi
        .fn()
        .mockImplementation((options) => {
          capturedInvokeAgent = options.invokeAgent;
          return { name: 'agent-communication' } as DynamicStructuredTool;
        });

      const config = {
        agentId: 'target-agent-1',
      };

      await template.create(config, compiledNodes);

      // Clear the compiled nodes to simulate agent not found during invocation
      compiledNodes.clear();

      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'parent-thread' },
      } as any;

      await expect(
        capturedInvokeAgent(['message'], 'child-1', mockRunnableConfig),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle agent execution errors', async () => {
      let capturedInvokeAgent: any;
      mockAgentCommunicationTool.build = vi
        .fn()
        .mockImplementation((options) => {
          capturedInvokeAgent = options.invokeAgent;
          return { name: 'agent-communication' } as DynamicStructuredTool;
        });

      const mockError = new Error('Agent execution failed');
      mockAgent.run = vi.fn().mockRejectedValue(mockError);

      const config = {
        agentId: 'target-agent-1',
      };

      await template.create(config, compiledNodes);

      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'parent-thread' },
      } as any;

      await expect(
        capturedInvokeAgent(['message'], 'child-1', mockRunnableConfig),
      ).rejects.toThrow('Agent execution failed');
    });

    it('should create unique thread IDs for different child threads', async () => {
      let capturedInvokeAgent: any;
      mockAgentCommunicationTool.build = vi
        .fn()
        .mockImplementation((options) => {
          capturedInvokeAgent = options.invokeAgent;
          return { name: 'agent-communication' } as DynamicStructuredTool;
        });

      const config = {
        agentId: 'target-agent-1',
      };

      await template.create(config, compiledNodes);

      const mockRunnableConfig: ToolRunnableConfig<BaseAgentConfigurable> = {
        configurable: { thread_id: 'parent-123' },
      } as any;

      // Test different child thread IDs
      await capturedInvokeAgent(['msg1'], 'child-A', mockRunnableConfig);
      await capturedInvokeAgent(['msg2'], 'child-B', mockRunnableConfig);

      expect(mockAgent.run).toHaveBeenNthCalledWith(
        1,
        'parent-123__child-A',
        [new HumanMessage('msg1')],
        mockAgentNode.instance.config,
        mockRunnableConfig,
      );

      expect(mockAgent.run).toHaveBeenNthCalledWith(
        2,
        'parent-123__child-B',
        [new HumanMessage('msg2')],
        mockAgentNode.instance.config,
        mockRunnableConfig,
      );
    });
  });
});
