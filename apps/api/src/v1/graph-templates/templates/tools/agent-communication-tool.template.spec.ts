import { HumanMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCommunicationTool } from '../../../agent-tools/tools/agent-communication.tool';
import { SimpleAgent } from '../../../agents/services/agents/simple-agent';
import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import {
  CompiledGraphNode,
  GraphNodeStatus,
  NodeKind,
} from '../../../graphs/graphs.types';
import { SimpleAgentTemplateResult } from '../base-node.template';
import { AgentCommunicationToolTemplate } from './agent-communication-tool.template';

const buildCompiledNode = <TInstance>(options: {
  id: string;
  type: NodeKind;
  template: string;
  instance: TInstance;
  config?: unknown;
}): CompiledGraphNode<TInstance> =>
  ({
    ...options,
    config: options.config ?? {},
    getStatus: () => GraphNodeStatus.Idle,
  }) as unknown as CompiledGraphNode<TInstance>;

describe('AgentCommunicationToolTemplate', () => {
  let template: AgentCommunicationToolTemplate;
  let mockAgentCommunicationTool: AgentCommunicationTool;
  let mockAgent: SimpleAgent;

  beforeEach(async () => {
    mockAgent = {
      run: vi.fn().mockResolvedValue({
        messages: [new HumanMessage('Agent response')],
        threadId: 'test-thread',
      }),
      checkpointer: {} as any,
      logger: {} as any,
      notificationsService: {} as any,
      buildState: vi.fn(),
      buildGraph: vi.fn(),
      buildLLM: vi.fn(),
      addTool: vi.fn(),
      schema: {} as any,
    } as unknown as SimpleAgent;

    mockAgentCommunicationTool = {
      description:
        'Request assistance from another registered agent by providing target agent id, context messages, and optional payload.',
      build: vi.fn().mockImplementation((config) => ({
        name: 'agent-communication',
        description:
          config.description || mockAgentCommunicationTool.description,
        invoke: vi.fn(),
      })),
    } as unknown as AgentCommunicationTool;

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
      const agentNode = buildCompiledNode<SimpleAgentTemplateResult<unknown>>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      });

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
      const agentNode = buildCompiledNode<SimpleAgentTemplateResult<unknown>>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      });

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
      const agentNode = buildCompiledNode<SimpleAgentTemplateResult<unknown>>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      });

      const outputNodes = new Map([['agent-2', agentNode]]);
      const config = {};

      await template.create(config, new Map(), outputNodes, {
        graphId: 'test-graph',
        nodeId: 'comm-tool',
        version: '1.0.0',
      });

      expect(mockAgentCommunicationTool.build).toHaveBeenCalled();
      const buildCall = vi.mocked(mockAgentCommunicationTool.build).mock
        .calls[0]![0];
      const invokeAgent = buildCall.invokeAgent;

      // Test the invokeAgent function
      const mockRunnableConfig = {
        configurable: {
          thread_id: 'parent-thread-123',
          parent_thread_id: 'root-thread-456',
          graph_id: 'test-graph',
          node_id: 'agent-1',
        },
      } as RunnableConfig<BaseAgentConfigurable>;

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
      const agentNode = buildCompiledNode<SimpleAgentTemplateResult<unknown>>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      });

      const outputNodes = new Map([['agent-2', agentNode]]);
      const config = {};

      await template.create(config, new Map(), outputNodes, {
        graphId: 'test-graph',
        nodeId: 'comm-tool',
        version: '1.0.0',
      });

      const buildCall = vi.mocked(mockAgentCommunicationTool.build).mock
        .calls[0]![0];
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
      } as RunnableConfig<BaseAgentConfigurable>;

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
      vi.mocked(mockAgent.run).mockClear();

      // Simulate Agent B -> Agent C call (using same parent thread)
      const agentBConfig = {
        configurable: {
          thread_id: 'root-thread-456__agent-b',
          parent_thread_id: 'root-thread-456', // Same parent thread
          internal_thread_id: 'internal-thread-789', // Same internal thread
          graph_id: 'test-graph',
          node_id: 'agent-b',
        },
      } as RunnableConfig<BaseAgentConfigurable>;

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
      const agentNode = buildCompiledNode<SimpleAgentTemplateResult<unknown>>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      });

      const outputNodes = new Map([['agent-2', agentNode]]);
      const config = {};

      await template.create(config, new Map(), outputNodes, {
        graphId: 'test-graph',
        nodeId: 'comm-tool',
        version: '1.0.0',
      });

      const buildCall = vi.mocked(mockAgentCommunicationTool.build).mock
        .calls[0]![0];
      const invokeAgent = buildCall.invokeAgent;

      // Test without parent_thread_id
      const mockRunnableConfig = {
        configurable: {
          thread_id: 'current-thread-123',
          // No parent_thread_id
          graph_id: 'test-graph',
          node_id: 'agent-1',
        },
      } as RunnableConfig<BaseAgentConfigurable>;

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

    it('should return message instead of all messages', async () => {
      const agentNode = buildCompiledNode<SimpleAgentTemplateResult<unknown>>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: {
          agent: mockAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      });

      const outputNodes = new Map([['agent-2', agentNode]]);
      const config = {};

      await template.create(config, new Map(), outputNodes, {
        graphId: 'test-graph',
        nodeId: 'comm-tool',
        version: '1.0.0',
      });

      const buildCall = vi.mocked(mockAgentCommunicationTool.build).mock
        .calls[0]![0];
      const invokeAgent = buildCall.invokeAgent;

      const mockRunnableConfig = {
        configurable: {
          thread_id: 'test-thread',
          parent_thread_id: 'root-thread',
          graph_id: 'test-graph',
          node_id: 'agent-1',
        },
      } as RunnableConfig<BaseAgentConfigurable>;

      const messages = ['Test message'];
      const result = await invokeAgent(messages, mockRunnableConfig);

      // Verify that the result contains message extracted from the last message
      expect(result).toEqual({
        message: 'Agent response',
        threadId: 'test-thread',
        checkpointNs: undefined,
        needsMoreInfo: false,
      });

      // Verify that messages are not included in the result
      expect(result.messages).toBeUndefined();
    });

    it('should handle empty messages gracefully', async () => {
      // Mock agent that returns empty messages
      const mockAgentEmptyMessages = {
        run: vi.fn().mockResolvedValue({
          messages: [],
          threadId: 'test-thread',
        }),
      } as RunnableConfig<BaseAgentConfigurable>;

      const agentNode = buildCompiledNode<SimpleAgentTemplateResult<unknown>>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {},
        instance: {
          agent: mockAgentEmptyMessages as unknown as SimpleAgent,
          config: {
            name: 'Test Agent',
            instructions: 'Test instructions',
            invokeModelName: 'gpt-5-mini',
          },
        },
      });

      const outputNodes = new Map([['agent-2', agentNode]]);
      const config = {};

      await template.create(config, new Map(), outputNodes, {
        graphId: 'test-graph',
        nodeId: 'comm-tool',
        version: '1.0.0',
      });

      const buildCall = vi.mocked(mockAgentCommunicationTool.build).mock
        .calls[0]![0];
      const invokeAgent = buildCall.invokeAgent;

      const mockRunnableConfig = {
        configurable: {
          thread_id: 'test-thread',
          parent_thread_id: 'root-thread',
          graph_id: 'test-graph',
          node_id: 'agent-1',
        },
      } as RunnableConfig<BaseAgentConfigurable>;

      const messages = ['Test message'];
      const result = await invokeAgent(messages, mockRunnableConfig);

      // Verify fallback message when no messages are available
      expect(result).toEqual({
        message: 'No response message available',
        threadId: 'test-thread',
        checkpointNs: undefined,
        needsMoreInfo: false,
      });
    });
  });
});
