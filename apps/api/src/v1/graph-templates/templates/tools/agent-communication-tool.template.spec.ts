import { HumanMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommunicationToolGroup } from '../../../agent-tools/tools/common/communication/communication-tool-group';
import { SimpleAgent } from '../../../agents/services/agents/simple-agent';
import { BaseAgentConfigurable } from '../../../agents/services/nodes/base-node';
import {
  CompiledGraphNode,
  GraphNode,
  GraphNodeInstanceHandle,
  GraphNodeStatus,
  NodeKind,
} from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { AgentCommunicationToolTemplate } from './agent-communication-tool.template';

const makeHandle = <TInstance>(
  instance: TInstance,
): GraphNodeInstanceHandle<TInstance, any> => ({
  provide: async () => instance,
  configure: async () => {},
  destroy: async () => {},
});

const buildCompiledNode = <TInstance>(options: {
  id: string;
  type: NodeKind;
  template: string;
  instance: TInstance;
  config?: unknown;
}): CompiledGraphNode<TInstance> =>
  ({
    ...options,
    handle: makeHandle(options.instance),
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
      config: {
        name: 'Agent One',
        description: 'Test agent one',
      },
    });

    mockCommunicationToolGroup = {
      buildTools: vi.fn().mockImplementation((_config) => [
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

  describe('configuration', () => {
    it('should accept empty config', () => {
      expect(() => template.schema.parse({})).not.toThrow();
    });

    it('should accept config with metadata', () => {
      const config = {
        metadata: {
          key: 'value',
          num: 123,
          bool: true,
        },
      };
      expect(() => template.schema.parse(config)).not.toThrow();
    });

    it('should ignore legacy/unknown fields', () => {
      const config = {
        unknownField: 'value',
      };
      const parsed = template.schema.parse(config);
      expect(parsed).not.toHaveProperty('unknownField');
    });
  });

  describe('create', () => {
    it('should create communication tool group with communication_exec tool', async () => {
      const metadata = {
        graphId: 'graph-1',
        nodeId: 'tool-node',
        version: '1',
      };
      const outputNodeIds = new Set(['agent-1']);

      const handle = await template.create();
      const init: GraphNode<Record<string, never>> = {
        config: {},
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockCommunicationToolGroup.buildTools).toHaveBeenCalled();
      const calls = vi.mocked(mockCommunicationToolGroup.buildTools).mock.calls;
      expect(calls).toHaveLength(1);
      const buildConfig = calls[0]![0] as any;
      expect(buildConfig.agents).toHaveLength(1);
      expect(buildConfig.agents[0].name).toBe('Agent One');
      expect(buildConfig.agents[0].description).toBe('Test agent one');
    });

    it('should support multiple agents', async () => {
      const agent2Node = buildCompiledNode({
        id: 'agent-2',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: mockAgent,
        config: {
          name: 'Agent Two',
          description: 'Test agent two',
        },
      });

      vi.mocked(mockGraphRegistry.filterNodesByType).mockReturnValue([
        'agent-1',
        'agent-2',
      ]);
      vi.mocked(mockGraphRegistry.getNode).mockImplementation((_gid, id) => {
        if (id === 'agent-1') return mockAgentNode;
        if (id === 'agent-2') return agent2Node;
        return undefined;
      });

      const metadata = {
        graphId: 'graph-1',
        nodeId: 'tool-node',
        version: '1',
      };
      const outputNodeIds = new Set(['agent-1', 'agent-2']);

      const handle = await template.create();
      const init: GraphNode<Record<string, never>> = {
        config: {},
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      const calls = vi.mocked(mockCommunicationToolGroup.buildTools).mock.calls;
      expect(calls).toHaveLength(1);
      const buildConfig = calls[0]![0] as any;
      expect(buildConfig.agents).toHaveLength(2);
      expect(buildConfig.agents[0].name).toBe('Agent One');
      expect(buildConfig.agents[1].name).toBe('Agent Two');
    });

    it('should throw error when agent config is missing name or description', async () => {
      const invalidAgentNode = buildCompiledNode({
        id: 'agent-1',
        type: NodeKind.SimpleAgent,
        template: 'simple-agent',
        instance: mockAgent,
        config: {}, // missing name and description
      });

      vi.mocked(mockGraphRegistry.getNode).mockReturnValue(invalidAgentNode);

      const metadata = {
        graphId: 'graph-1',
        nodeId: 'tool-node',
        version: '1',
      };
      const outputNodeIds = new Set(['agent-1']);

      const handle = await template.create();
      const init: GraphNode<Record<string, never>> = {
        config: {},
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata,
      };
      const instance = await handle.provide(init);

      await expect(handle.configure(init, instance)).rejects.toThrow(
        /must have name and description configured/,
      );
    });

    it('should create tool with consistent thread ID behavior', async () => {
      const metadata = {
        graphId: 'graph-1',
        nodeId: 'tool-node',
        version: '1',
      };
      const outputNodeIds = new Set(['agent-1']);

      const handle = await template.create();
      const init: GraphNode<Record<string, never>> = {
        config: {},
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      const buildCalls = vi.mocked(mockCommunicationToolGroup.buildTools).mock.calls;
      expect(buildCalls).toHaveLength(1);
      const buildConfig = buildCalls[0]![0] as any;
      expect(buildConfig.agents).toHaveLength(1);
      const agentInfo = buildConfig.agents[0];

      const toolConfig: RunnableConfig<BaseAgentConfigurable> = {
        configurable: {
          thread_id: 'parent-thread',
        },
      };

      await agentInfo.invokeAgent(['Hello'], toolConfig as any);

      expect(mockAgent.runOrAppend).toHaveBeenCalled();
      const runOrAppendCalls = vi.mocked(mockAgent.runOrAppend).mock.calls;
      expect(runOrAppendCalls).toHaveLength(1);
      const args = runOrAppendCalls[0]!;

      const threadId = args[0] as string;
      const messages = args[1] as any[];
      const runConfig = args[3] as any;

      expect(threadId).toBe('parent-thread__tool-node__Agent One');
      expect(messages).toHaveLength(1);
      expect(runConfig.configurable.thread_id).toBe(threadId);
      expect(runConfig.configurable.graph_id).toBe('graph-1');
      expectAgentInstructionMessage(messages[0] as HumanMessage, 'Hello');
      expect(runConfig.configurable.parent_thread_id).toBe('parent-thread');
      expect(runConfig.configurable.thread_id).toBe(
        'parent-thread__tool-node__Agent One',
      );
    });
  });
});
