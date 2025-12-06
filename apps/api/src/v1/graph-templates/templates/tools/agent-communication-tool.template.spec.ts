import { HumanMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunicationToolGroup } from '../../../agent-tools/tools/core/communication/communication-tool-group';
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
  let mockCommunicationToolGroup: CommunicationToolGroup;
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

    mockCommunicationToolGroup = {
      buildTools: vi.fn().mockImplementation((config) => [
        {
          name: 'communication_exec',
          description: 'Send a message to a specific agent',
          invoke: vi.fn(),
        },
      ]),
    } as unknown as CommunicationToolGroup;

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
          provide: CommunicationToolGroup,
          useValue: mockCommunicationToolGroup,
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
    it('should accept empty config', () => {
      const validConfig = {};

      expect(() => template.schema.parse(validConfig)).not.toThrow();
    });

    it('should accept config with metadata', () => {
      const validConfig = {
        metadata: {
          foo: 'bar',
          count: 123,
        },
      };

      expect(() => template.schema.parse(validConfig)).not.toThrow();
    });

    it('should ignore legacy/unknown fields', () => {
      const config = {
        metadata: { foo: 'bar' },
        extra: 'value',
        obsolete: true,
      };

      const parsed = template.schema.parse(config);
      expect(parsed.metadata).toEqual({ foo: 'bar' });
      expect(parsed).not.toHaveProperty('extra');
      expect(parsed).not.toHaveProperty('obsolete');
    });
  });

  describe('create', () => {
    it('should create communication tool group with communication_exec tool', async () => {
      const agentNode = buildCompiledNode<SimpleAgent>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          name: 'research-agent',
          description: 'Agent for research tasks',
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

      const builtTools = await template.create(
        config,
        new Set(),
        outputNodeIds,
        {
          graphId: 'test-graph',
          nodeId: 'comm-tool',
          version: '1.0.0',
        },
      );

      expect(builtTools).toHaveLength(1);
      expect(builtTools[0]?.name).toBe('communication_exec');
    });

    it('should support multiple agents', async () => {
      const agentNode1 = buildCompiledNode<SimpleAgent>({
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          name: 'research-agent',
          description: 'Agent for research tasks',
          instructions: 'Research instructions',
          invokeModelName: 'gpt-5-mini',
        },
        instance: mockAgent,
      });

      const agentNode2 = buildCompiledNode<SimpleAgent>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          name: 'coding-agent',
          description: 'Agent for coding tasks',
          instructions: 'Coding instructions',
          invokeModelName: 'gpt-5-mini',
        },
        instance: mockAgent,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['agent-1', 'agent-2']);
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((graphId, nodeId) => {
          if (nodeId === 'agent-1') return agentNode1;
          if (nodeId === 'agent-2') return agentNode2;
          return null;
        });

      const config = {};
      const outputNodeIds = new Set(['agent-1', 'agent-2']);

      const builtTools = await template.create(
        config,
        new Set(),
        outputNodeIds,
        {
          graphId: 'test-graph',
          nodeId: 'comm-tool',
          version: '1.0.0',
        },
      );

      expect(builtTools).toHaveLength(1);
      expect(mockCommunicationToolGroup.buildTools).toHaveBeenCalledWith({
        agents: expect.arrayContaining([
          expect.objectContaining({
            name: 'research-agent',
            description: 'Agent for research tasks',
          }),
          expect.objectContaining({
            name: 'coding-agent',
            description: 'Agent for coding tasks',
          }),
        ]),
      });
    });

    it('should throw error when agent config is missing name or description', async () => {
      const agentNode = buildCompiledNode<SimpleAgent>({
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          instructions: 'Test instructions',
          invokeModelName: 'gpt-5-mini',
        },
        instance: mockAgent,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['agent-1']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(agentNode);

      const config = {};
      const outputNodeIds = new Set(['agent-1']);

      await expect(
        template.create(config, new Set(), outputNodeIds, {
          graphId: 'test-graph',
          nodeId: 'comm-tool',
          version: '1.0.0',
        }),
      ).rejects.toThrow('must have name and description configured');
    });

    it('should create tool with consistent thread ID behavior', async () => {
      const agentNode = buildCompiledNode<SimpleAgent>({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        config: {
          name: 'research-agent',
          description: 'Agent for research tasks',
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

      expect(mockCommunicationToolGroup.buildTools).toHaveBeenCalled();
      const buildCall = vi.mocked(mockCommunicationToolGroup.buildTools).mock
        .calls[0]![0];
      const agentInfo = buildCall.agents[0]!;
      const invokeAgent = agentInfo.invokeAgent;

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

      expect(threadId).toBe('root-thread-456__comm-tool__research-agent');
      expect(configArg).toBeUndefined();
      expect(runnableConfigArg).toEqual(
        expect.objectContaining({
          configurable: expect.objectContaining({
            thread_id: 'root-thread-456__comm-tool__research-agent',
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
  });
});
