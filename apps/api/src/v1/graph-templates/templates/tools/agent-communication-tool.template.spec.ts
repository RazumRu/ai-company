import { HumanMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCommunicationTool } from '../../../agent-tools/tools/core/agent-communication.tool';
import { SimpleAgent } from '../../../agents/services/agents/simple-agent';
import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import {
  CompiledGraphNode,
  GraphNodeStatus,
  NodeKind,
} from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
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

const expectAgentInstructionMessage = (
  message: HumanMessage,
  expectedContent: string,
) => {
  expect(message).toBeInstanceOf(HumanMessage);
  expect(message.content).toBe(expectedContent);
  expect(message.additional_kwargs?.isAgentInstructionMessage).toBe(true);
};

describe('AgentCommunicationToolTemplate', () => {
  let template: AgentCommunicationToolTemplate;
  let mockAgentCommunicationTool: AgentCommunicationTool;
  let mockAgent: SimpleAgent;
  let mockGraphRegistry: GraphRegistry;
  let mockAgentNode: CompiledGraphNode<SimpleAgent>;

  beforeEach(async () => {
    mockAgent = {
      runOrAppend: vi.fn().mockResolvedValue({
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

    mockAgentNode = buildCompiledNode({
      id: 'agent-1',
      type: NodeKind.SimpleAgent,
      template: 'simple-agent',
      instance: mockAgent,
    });

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

    mockGraphRegistry = {
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      getNode: vi.fn().mockReturnValue(mockAgentNode),
      filterNodesByType: vi.fn().mockReturnValue(['agent-1']),
      destroy: vi.fn(),
    } as unknown as GraphRegistry;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentCommunicationToolTemplate,
        {
          provide: AgentCommunicationTool,
          useValue: mockAgentCommunicationTool,
        },
        {
          provide: GraphRegistry,
          useValue: mockGraphRegistry,
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
      const agentNode = buildCompiledNode<SimpleAgent>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          name: 'Test Agent',
          instructions: 'Test instructions',
          invokeModelName: 'gpt-5-mini',
        },
        instance: mockAgent,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['agent-2']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(agentNode);

      const config = {
        description:
          'Use this tool to communicate with the customer service agent for handling support requests',
      };
      const outputNodeIds = new Set(['agent-2']);

      const builtTool = await template.create(
        config,
        new Set(),
        outputNodeIds,
        {
          graphId: 'test-graph',
          nodeId: 'comm-tool',
          version: '1.0.0',
        },
      );

      expect(builtTool[0]?.description).toBe(
        'Use this tool to communicate with the customer service agent for handling support requests',
      );
    });

    it('should use default description when no custom description provided', async () => {
      const agentNode = buildCompiledNode<SimpleAgent>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          name: 'Test Agent',
          instructions: 'Test instructions',
          invokeModelName: 'gpt-5-mini',
        },
        instance: mockAgent,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['agent-2']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(agentNode);

      const config = {};
      const outputNodeIds = new Set(['agent-2']);

      const builtTool = await template.create(
        config,
        new Set(),
        outputNodeIds,
        {
          graphId: 'test-graph',
          nodeId: 'comm-tool',
          version: '1.0.0',
        },
      );

      expect(builtTool[0]?.description).toBe(
        'Request assistance from another registered agent by providing target agent id, context messages, and optional payload.',
      );
    });

    it('should create tool with consistent thread ID behavior', async () => {
      const agentNode = buildCompiledNode<SimpleAgent>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          name: 'Test Agent',
          instructions: 'Test instructions',
          invokeModelName: 'gpt-5-mini',
        },
        instance: mockAgent,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['agent-2']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(agentNode);

      const config = {};
      const outputNodeIds = new Set(['agent-2']);

      await template.create(config, new Set(), outputNodeIds, {
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

      // Verify the agent was called with the correct thread ID and metadata
      expect(mockAgent.runOrAppend).toHaveBeenCalledTimes(1);
      const [threadId, preparedMessages, configArg, runnableConfigArg] =
        vi.mocked(mockAgent.runOrAppend).mock.calls[0]!;

      expect(threadId).toBe('root-thread-456__comm-tool');
      expect(configArg).toBeUndefined();
      expect(runnableConfigArg).toEqual(
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: 'root-thread-456__comm-tool',
            parent_thread_id: 'root-thread-456',
            graph_id: 'test-graph',
            node_id: 'agent-2',
          }),
        }),
      );

      expect(preparedMessages).toHaveLength(1);
      expectAgentInstructionMessage(
        preparedMessages[0] as HumanMessage,
        'Hello from Agent A',
      );
    });

    it('should maintain thread consistency for Agent A -> Agent B -> Agent C chain', async () => {
      const agentNode = buildCompiledNode<SimpleAgent>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          name: 'Test Agent',
          instructions: 'Test instructions',
          invokeModelName: 'gpt-5-mini',
        },
        instance: mockAgent,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['agent-2']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(agentNode);

      const config = {};
      const outputNodeIds = new Set(['agent-2']);

      await template.create(config, new Set(), outputNodeIds, {
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
      expect(mockAgent.runOrAppend).toHaveBeenCalledTimes(1);
      const [
        firstThreadId,
        firstMessages,
        firstConfigArg,
        firstRunnableConfig,
      ] = vi.mocked(mockAgent.runOrAppend).mock.calls[0]!;

      expect(firstThreadId).toBe('root-thread-456__comm-tool');
      expect(firstConfigArg).toBeUndefined();
      expect(firstRunnableConfig).toEqual(
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: 'root-thread-456__comm-tool',
            parent_thread_id: 'root-thread-456',
          }),
        }),
      );
      expect(firstMessages).toHaveLength(1);
      expectAgentInstructionMessage(
        firstMessages[0] as HumanMessage,
        'Message from A to B',
      );

      // Reset mock for next call
      vi.mocked(mockAgent.runOrAppend).mockClear();

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
      expect(mockAgent.runOrAppend).toHaveBeenCalledTimes(1);
      const [
        secondThreadId,
        secondMessages,
        secondConfigArg,
        secondRunnableConfig,
      ] = vi.mocked(mockAgent.runOrAppend).mock.calls[0]!;

      expect(secondThreadId).toBe('root-thread-456__comm-tool');
      expect(secondConfigArg).toBeUndefined();
      expect(secondRunnableConfig).toEqual(
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: 'root-thread-456__comm-tool',
            parent_thread_id: 'root-thread-456',
          }),
        }),
      );
      expect(secondMessages).toHaveLength(1);
      expectAgentInstructionMessage(
        secondMessages[0] as HumanMessage,
        'Message from B to C',
      );
    });

    it('should fallback to current thread_id when no parent_thread_id is provided', async () => {
      const agentNode = buildCompiledNode<SimpleAgent>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          name: 'Test Agent',
          instructions: 'Test instructions',
          invokeModelName: 'gpt-5-mini',
        },
        instance: mockAgent,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['agent-2']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(agentNode);

      const config = {};
      const outputNodeIds = new Set(['agent-2']);

      await template.create(config, new Set(), outputNodeIds, {
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
      expect(mockAgent.runOrAppend).toHaveBeenCalledTimes(1);
      const [threadId, injectedMessages, configArg, runnableConfigArg] =
        vi.mocked(mockAgent.runOrAppend).mock.calls[0]!;

      expect(threadId).toBe('current-thread-123__comm-tool');
      expect(configArg).toBeUndefined();
      expect(runnableConfigArg).toEqual(
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: 'current-thread-123__comm-tool',
            parent_thread_id: 'current-thread-123',
          }),
        }),
      );
      expect(injectedMessages).toHaveLength(1);
      expectAgentInstructionMessage(
        injectedMessages[0] as HumanMessage,
        'Test message',
      );
    });

    it('should return message instead of all messages', async () => {
      const agentNode = buildCompiledNode<SimpleAgent>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          name: 'Test Agent',
          instructions: 'Test instructions',
          invokeModelName: 'gpt-5-mini',
        },
        instance: mockAgent,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['agent-2']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(agentNode);

      const config = {};
      const outputNodeIds = new Set(['agent-2']);

      await template.create(config, new Set(), outputNodeIds, {
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
        runOrAppend: vi.fn().mockResolvedValue({
          messages: [],
          threadId: 'test-thread',
        }),
      } as unknown as SimpleAgent;

      const agentNode = buildCompiledNode<SimpleAgent>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          name: 'Test Agent',
          instructions: 'Test instructions',
          invokeModelName: 'gpt-5-mini',
        },
        instance: mockAgentEmptyMessages,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['agent-2']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(agentNode);

      const config = {};
      const outputNodeIds = new Set(['agent-2']);

      await template.create(config, new Set(), outputNodeIds, {
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
