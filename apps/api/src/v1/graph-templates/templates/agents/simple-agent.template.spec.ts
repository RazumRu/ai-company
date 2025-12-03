import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ReasoningEffort } from '../../../agents/agents.types';
import { AgentFactoryService } from '../../../agents/services/agent-factory.service';
import { SimpleAgent } from '../../../agents/services/agents/simple-agent';
import {
  CompiledGraphNode,
  GraphNodeStatus,
  NodeKind,
} from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import {
  SimpleAgentTemplate,
  SimpleAgentTemplateSchema,
} from './simple-agent.template';

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

describe('SimpleAgentTemplate', () => {
  let template: SimpleAgentTemplate;
  let mockSimpleAgent: SimpleAgent;
  let mockAgentFactoryService: AgentFactoryService;
  let mockGraphRegistry: GraphRegistry;

  beforeEach(async () => {
    mockSimpleAgent = {
      addTool: vi.fn(),
      run: vi.fn(),
      setConfig: vi.fn(),
      schema: {} as SimpleAgent['schema'],
      buildLLM: vi.fn(),
    } as unknown as SimpleAgent;

    mockAgentFactoryService = {
      create: vi.fn().mockResolvedValue(mockSimpleAgent),
      register: vi.fn(),
    } as unknown as AgentFactoryService;

    mockGraphRegistry = {
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      getNode: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GraphRegistry;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimpleAgentTemplate,
        {
          provide: AgentFactoryService,
          useValue: mockAgentFactoryService,
        },
        {
          provide: GraphRegistry,
          useValue: mockGraphRegistry,
        },
      ],
    }).compile();

    template = module.get<SimpleAgentTemplate>(SimpleAgentTemplate);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('Simple agent');
    });

    it('should have correct description', () => {
      expect(template.description).toBe(
        'Configurable agent that can use connected tools and triggers',
      );
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.SimpleAgent);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(SimpleAgentTemplateSchema);
    });
  });

  describe('schema validation', () => {
    it('should validate required SimpleAgent fields', () => {
      const validConfig = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
      };

      expect(() => SimpleAgentTemplateSchema.parse(validConfig)).not.toThrow();
    });

    it('should validate with optional toolNodeIds', () => {
      const validConfig = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
      };

      expect(() => SimpleAgentTemplateSchema.parse(validConfig)).not.toThrow();
    });

    it('should validate with optional enforceToolUsage', () => {
      const validConfig = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        enforceToolUsage: true,
      };

      expect(() => SimpleAgentTemplateSchema.parse(validConfig)).not.toThrow();

      const parsed = SimpleAgentTemplateSchema.parse(validConfig);
      expect(parsed.enforceToolUsage).toBe(true);
    });

    it('should have enforceToolUsage undefined when not provided (defaults to true in code)', () => {
      const configWithoutEnforce = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
      };

      const parsed = SimpleAgentTemplateSchema.parse(configWithoutEnforce);
      expect(parsed.enforceToolUsage).toBeUndefined();
    });

    it('should reject missing required fields', () => {
      const invalidConfig = {
        // missing required SimpleAgent fields
      };

      expect(() => SimpleAgentTemplateSchema.parse(invalidConfig)).toThrow();
    });

    it('should validate valid configuration', () => {
      const validConfig = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
      };

      expect(() => SimpleAgentTemplateSchema.parse(validConfig)).not.toThrow();
    });
  });

  describe('create', () => {
    let mockTool1: DynamicStructuredTool;
    let mockTool2: DynamicStructuredTool;
    let mockToolNode1: CompiledGraphNode<DynamicStructuredTool>;
    let mockToolNode2: CompiledGraphNode<DynamicStructuredTool>;
    let _connectedNodes: Map<string, CompiledGraphNode>;

    beforeEach(() => {
      mockTool1 = {
        name: 'tool-1',
        invoke: vi.fn(),
      } as unknown as DynamicStructuredTool;
      mockTool2 = {
        name: 'tool-2',
        invoke: vi.fn(),
      } as unknown as DynamicStructuredTool;

      mockToolNode1 = buildCompiledNode<DynamicStructuredTool>({
        id: 'tool-1',
        type: NodeKind.Tool,
        template: 'web-search-tool',
        config: {},
        instance: mockTool1,
      });

      mockToolNode2 = buildCompiledNode<DynamicStructuredTool>({
        id: 'tool-2',
        type: NodeKind.Tool,
        template: 'shell-tool',
        config: {},
        instance: mockTool2,
      });

      _connectedNodes = new Map([
        ['tool-1', mockToolNode1],
        ['tool-2', mockToolNode2],
      ]);

      // Configure mockGraphRegistry to return nodes
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((graphId, nodeId) => {
          if (nodeId === 'tool-1') return mockToolNode1;
          if (nodeId === 'tool-2') return mockToolNode2;
          return undefined;
        });
    });

    it('should create simple agent without tools', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      // Use empty node ID sets
      const emptyInputNodeIds = new Set<string>();
      const emptyOutputNodeIds = new Set<string>();

      const result = await template.create(
        config,
        emptyInputNodeIds,
        emptyOutputNodeIds,
        {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        },
      );

      expect(mockAgentFactoryService.create).toHaveBeenCalledWith(SimpleAgent);
      expect(mockSimpleAgent.addTool).not.toHaveBeenCalled();
      expect(result).toBe(mockSimpleAgent);
    });

    it('should create simple agent without connected tools', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      // Create empty node ID sets
      const emptyInputNodeIds = new Set<string>();
      const emptyOutputNodeIds = new Set<string>();

      const result = await template.create(
        config,
        emptyInputNodeIds,
        emptyOutputNodeIds,
        {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        },
      );

      expect(mockSimpleAgent.addTool).not.toHaveBeenCalled();
      expect(result).toBe(mockSimpleAgent);
    });

    it('should create simple agent with connected tools', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      const outputNodeIds = new Set(['tool-1', 'tool-2']);

      const result = await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockSimpleAgent.addTool).toHaveBeenCalledTimes(2);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(mockTool1);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(mockTool2);
      expect(result).toBe(mockSimpleAgent);
    });

    it('should handle connected tool nodes', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      const outputNodeIds = new Set(['tool-1', 'tool-2']);

      const _result = await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      // Should add all connected tool nodes
      expect(mockSimpleAgent.addTool).toHaveBeenCalledTimes(2);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(mockTool1);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(mockTool2);
    });

    it('should handle partial tool availability', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      // Only tool-1 is available, tool-2 is not in registry
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((graphId, nodeId) => {
          if (nodeId === 'tool-1') return mockToolNode1;
          return undefined; // tool-2 is missing
        });

      const outputNodeIds = new Set(['tool-1', 'tool-2']);

      const _result = await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      // Should only add available tools
      expect(mockSimpleAgent.addTool).toHaveBeenCalledTimes(1);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(mockTool1);
    });

    it('should handle factory errors', async () => {
      const mockError = new Error('Failed to create SimpleAgent');
      const failingAgentFactoryService = {
        create: vi.fn().mockRejectedValue(mockError),
        register: vi.fn(),
      } as unknown as AgentFactoryService;

      // Recreate template with failing factory service
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SimpleAgentTemplate,
          {
            provide: AgentFactoryService,
            useValue: failingAgentFactoryService,
          },
          {
            provide: GraphRegistry,
            useValue: mockGraphRegistry,
          },
        ],
      }).compile();

      const failingTemplate =
        module.get<SimpleAgentTemplate>(SimpleAgentTemplate);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      await expect(
        failingTemplate.create(config, new Set(), new Set(), {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow('Failed to create SimpleAgent');
    });

    it('should handle addTool errors', async () => {
      const mockError = new Error('Failed to add tool');
      mockSimpleAgent.addTool = vi.fn().mockImplementation(() => {
        throw mockError;
      });

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      const outputNodeIds = new Set(['tool-1', 'tool-2']);

      await expect(
        template.create(config, new Set(), outputNodeIds, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow('Failed to add tool');
    });

    it('should preserve original config structure', async () => {
      const config = {
        summarizeMaxTokens: 2000,
        summarizeKeepTokens: 1000,
        instructions: 'Custom instructions',
        name: 'Custom Agent',
        description: 'Custom agent description',
        invokeModelName: 'gpt-3.5-turbo',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      const outputNodeIds = new Set(['tool-1', 'tool-2']);

      const result = await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(result).toBe(mockSimpleAgent);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledTimes(2);
    });

    it('should return correct result type', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        description: 'Test agent description',
        invokeModelName: 'gpt-5-mini',
        invokeModelReasoningEffort: ReasoningEffort.None,
        maxIterations: 50,
      };

      const outputNodeIds = new Set(['tool-1', 'tool-2']);

      const result = await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(result).toBe(mockSimpleAgent);
      expect(result).toBeInstanceOf(Object);
    });
  });
});
