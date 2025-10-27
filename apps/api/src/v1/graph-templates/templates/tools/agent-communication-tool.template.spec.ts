import { HumanMessage } from '@langchain/core/messages';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCommunicationTool } from '../../../agent-tools/tools/agent-communication.tool';
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
import { SimpleAgentTemplateResult } from '../base-node.template';
import { AgentCommunicationToolTemplate } from './agent-communication-tool.template';

describe('AgentCommunicationToolTemplate', () => {
  let template: AgentCommunicationToolTemplate;
  let mockAgentCommunicationTool: AgentCommunicationTool;
  let mockAgent: any;

  beforeEach(async () => {
    mockAgent = {
      run: vi.fn().mockResolvedValue({
        messages: [new HumanMessage('Agent response')],
        threadId: 'test-thread',
      }),
    };

    mockAgentCommunicationTool = {
      description:
        'Request assistance from another registered agent by providing target agent id, context messages, and optional payload.',
      build: vi.fn().mockImplementation((config) => ({
        name: 'agent-communication',
        description:
          config.description || mockAgentCommunicationTool.description,
        invoke: vi.fn(),
      })),
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

  describe('schema validation', () => {
    it('should validate optional description field', () => {
      const validConfig = {
        description: 'Custom tool description for specific agent communication',
      };

      expect(() => template.schema.parse(validConfig)).not.toThrow();
    });

    it('should work with empty config', () => {
      const validConfig = {};

      expect(() => template.schema.parse(validConfig)).not.toThrow();
    });

    it('should reject invalid description type', () => {
      const invalidConfig = {
        description: 123, // Should be string
      };

      expect(() => template.schema.parse(invalidConfig)).toThrow();
    });
  });

  describe('create', () => {
    it('should create tool with custom description when provided', async () => {
      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      };

      const outputNodes = new Map([['agent-2', agentNode]]);
      const config = {
        description:
          'Use this tool to communicate with the customer service agent for handling support requests',
      };

      const builtTool = await template.create(config, new Map(), outputNodes, {
        graphId: 'test-graph',
        nodeId: 'comm-tool',
        version: '1.0.0',
      });

      expect(builtTool.description).toBe(
        'Use this tool to communicate with the customer service agent for handling support requests',
      );
    });

    it('should use default description when no custom description provided', async () => {
      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      };

      const outputNodes = new Map([['agent-2', agentNode]]);
      const config = {};

      const builtTool = await template.create(config, new Map(), outputNodes, {
        graphId: 'test-graph',
        nodeId: 'comm-tool',
        version: '1.0.0',
      });

      expect(builtTool.description).toBe(
        'Request assistance from another registered agent by providing target agent id, context messages, and optional payload.',
      );
    });

    it('should create tool with consistent thread ID behavior', async () => {
      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      };

      const outputNodes = new Map([['agent-2', agentNode]]);
      const config = {};

      await template.create(config, new Map(), outputNodes, {
        graphId: 'test-graph',
        nodeId: 'comm-tool',
        version: '1.0.0',
      });

      expect(mockAgentCommunicationTool.build).toHaveBeenCalled();
      const buildCall = (mockAgentCommunicationTool.build as any).mock
        .calls[0][0];
      const invokeAgent = buildCall.invokeAgent;

      // Test the invokeAgent function
      const mockRunnableConfig = {
        configurable: {
          thread_id: 'parent-thread-123',
          parent_thread_id: 'root-thread-456',
          graph_id: 'test-graph',
          node_id: 'agent-1',
        },
      } as any;

      const messages = ['Hello from Agent A'];
      await invokeAgent(messages, mockRunnableConfig);

      // Verify the agent was called with the correct thread ID
      expect(mockAgent.run).toHaveBeenCalledWith(
        'root-thread-456__comm-tool', // Uses parent + tool node id
        [new HumanMessage('Hello from Agent A')],
        agentNode.instance.config,
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: 'root-thread-456__comm-tool',
            parent_thread_id: 'root-thread-456',
            graph_id: 'test-graph',
            node_id: 'agent-2',
          }),
        }),
      );
    });

    it('should maintain thread consistency for Agent A -> Agent B -> Agent C chain', async () => {
      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      };

      const outputNodes = new Map([['agent-2', agentNode]]);
      const config = {};

      await template.create(config, new Map(), outputNodes, {
        graphId: 'test-graph',
        nodeId: 'comm-tool',
        version: '1.0.0',
      });

      const buildCall = (mockAgentCommunicationTool.build as any).mock
        .calls[0][0];
      const invokeAgent = buildCall.invokeAgent;

      // Simulate Agent A -> Agent B call
      const agentAConfig = {
        configurable: {
          thread_id: 'root-thread-456__agent-a',
          parent_thread_id: 'root-thread-456',
          internal_thread_id: 'internal-thread-789',
          graph_id: 'test-graph',
          node_id: 'agent-a',
        },
      } as any;

      await invokeAgent(['Message from A to B'], agentAConfig);

      // Verify Agent B gets consistent thread ID based on parent
      expect(mockAgent.run).toHaveBeenCalledWith(
        'root-thread-456__comm-tool', // parent + tool id
        [new HumanMessage('Message from A to B')],
        agentNode.instance.config,
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: 'root-thread-456__comm-tool',
            parent_thread_id: 'root-thread-456', // Same parent
          }),
        }),
      );

      // Reset mock for next call
      mockAgent.run.mockClear();

      // Simulate Agent B -> Agent C call (using same parent thread)
      const agentBConfig = {
        configurable: {
          thread_id: 'root-thread-456__agent-b',
          parent_thread_id: 'root-thread-456', // Same parent thread
          internal_thread_id: 'internal-thread-789', // Same internal thread
          graph_id: 'test-graph',
          node_id: 'agent-b',
        },
      } as any;

      await invokeAgent(['Message from B to C'], agentBConfig);

      // Verify Agent C also gets consistent thread ID
      expect(mockAgent.run).toHaveBeenCalledWith(
        'root-thread-456__comm-tool',
        [new HumanMessage('Message from B to C')],
        agentNode.instance.config,
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: 'root-thread-456__comm-tool',
            parent_thread_id: 'root-thread-456', // Same parent
          }),
        }),
      );
    });

    it('should fallback to current thread_id when no parent_thread_id is provided', async () => {
      const agentNode: CompiledGraphNode<SimpleAgentTemplateResult<any>> = {
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      };

      const outputNodes = new Map([['agent-2', agentNode]]);
      const config = {};

      await template.create(config, new Map(), outputNodes, {
        graphId: 'test-graph',
        nodeId: 'comm-tool',
        version: '1.0.0',
      });

      const buildCall = (mockAgentCommunicationTool.build as any).mock
        .calls[0][0];
      const invokeAgent = buildCall.invokeAgent;

      // Test without parent_thread_id
      const mockRunnableConfig = {
        configurable: {
          thread_id: 'current-thread-123',
          // No parent_thread_id
          graph_id: 'test-graph',
          node_id: 'agent-1',
        },
      } as any;

      await invokeAgent(['Test message'], mockRunnableConfig);

      // Should fallback to current thread_id
      expect(mockAgent.run).toHaveBeenCalledWith(
        'current-thread-123__comm-tool',
        [new HumanMessage('Test message')],
        agentNode.instance.config,
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: 'current-thread-123__comm-tool',
            parent_thread_id: 'current-thread-123',
          }),
        }),
      );
    });
  });
});
