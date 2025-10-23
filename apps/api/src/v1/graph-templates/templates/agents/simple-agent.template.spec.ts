import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentFactoryService } from '../../../agents/services/agent-factory.service';
import { SimpleAgent } from '../../../agents/services/agents/simple-agent';
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
import {
  SimpleAgentTemplate,
  SimpleAgentTemplateSchema,
} from './simple-agent.template';

describe('SimpleAgentTemplate', () => {
  let template: SimpleAgentTemplate;
  let mockSimpleAgent: SimpleAgent;
  let mockAgentFactoryService: AgentFactoryService;

  beforeEach(async () => {
    mockSimpleAgent = {
      addTool: vi.fn(),
      run: vi.fn(),
      schema: {} as any,
      buildLLM: vi.fn(),
    } as any;

    mockAgentFactoryService = {
      create: vi.fn().mockResolvedValue(mockSimpleAgent),
      register: vi.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimpleAgentTemplate,
        {
          provide: AgentFactoryService,
          useValue: mockAgentFactoryService,
        },
      ],
    }).compile();

    template = module.get<SimpleAgentTemplate>(SimpleAgentTemplate);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('simple-agent');
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
        invokeModelName: 'gpt-5-mini',
      };

      expect(() => SimpleAgentTemplateSchema.parse(validConfig)).not.toThrow();
    });

    it('should validate with optional toolNodeIds', () => {
      const validConfig = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-5-mini',
      };

      expect(() => SimpleAgentTemplateSchema.parse(validConfig)).not.toThrow();
    });

    it('should validate with optional enforceToolUsage', () => {
      const validConfig = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-5-mini',
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
        invokeModelName: 'gpt-5-mini',
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
        invokeModelName: 'gpt-5-mini',
      };

      expect(() => SimpleAgentTemplateSchema.parse(validConfig)).not.toThrow();
    });
  });

  describe('create', () => {
    let mockTool1: DynamicStructuredTool;
    let mockTool2: DynamicStructuredTool;
    let mockToolNode1: CompiledGraphNode<DynamicStructuredTool>;
    let mockToolNode2: CompiledGraphNode<DynamicStructuredTool>;
    let connectedNodes: Map<string, CompiledGraphNode>;

    beforeEach(() => {
      mockTool1 = { name: 'tool-1', invoke: vi.fn() } as any;
      mockTool2 = { name: 'tool-2', invoke: vi.fn() } as any;

      mockToolNode1 = {
        id: 'tool-1',
        type: NodeKind.Tool,
        template: 'web-search-tool',
        instance: mockTool1,
      };

      mockToolNode2 = {
        id: 'tool-2',
        type: NodeKind.Tool,
        template: 'shell-tool',
        instance: mockTool2,
      };

      connectedNodes = new Map([
        ['tool-1', mockToolNode1],
        ['tool-2', mockToolNode2],
      ]);
    });

    it('should create simple agent without tools', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-5-mini',
      };

      // Use empty connected nodes map
      const emptyConnectedNodes = new Map<string, CompiledGraphNode>();

      const result = await template.create(
        config,
        emptyConnectedNodes,
        new Map(),
        {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        },
      );

      expect(mockAgentFactoryService.create).toHaveBeenCalledWith(SimpleAgent);
      expect(mockSimpleAgent.addTool).not.toHaveBeenCalled();

      expect(result).toEqual({
        agent: mockSimpleAgent,
        config: {
          summarizeMaxTokens: 1000,
          summarizeKeepTokens: 500,
          instructions: 'Test agent instructions',
          name: 'Test Agent',
          invokeModelName: 'gpt-5-mini',
        },
      });
    });

    it('should create simple agent without connected tools', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-5-mini',
      };

      // Create empty connected nodes map
      const emptyConnectedNodes = new Map<string, CompiledGraphNode>();

      const result = await template.create(
        config,
        emptyConnectedNodes,
        new Map(),
        {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        },
      );

      expect(mockSimpleAgent.addTool).not.toHaveBeenCalled();
      expect(result.config).not.toHaveProperty('toolNodeIds');
    });

    it('should create simple agent with connected tools', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-5-mini',
      };

      const result = await template.create(config, connectedNodes, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockSimpleAgent.addTool).toHaveBeenCalledTimes(2);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(mockTool1);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(mockTool2);

      expect(result).toEqual({
        agent: mockSimpleAgent,
        config: {
          summarizeMaxTokens: 1000,
          summarizeKeepTokens: 500,
          instructions: 'Test agent instructions',
          name: 'Test Agent',
          invokeModelName: 'gpt-5-mini',
        },
      });
    });

    it('should handle connected tool nodes', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-5-mini',
      };

      const _result = await template.create(config, connectedNodes, new Map(), {
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
      const partialConnectedNodes = new Map([
        ['tool-1', mockToolNode1],
        // tool-2 is missing
      ]);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-5-mini',
      };

      const _result = await template.create(
        config,
        partialConnectedNodes,
        new Map(),
        {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        },
      );

      // Should only add available tools
      expect(mockSimpleAgent.addTool).toHaveBeenCalledTimes(1);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(mockTool1);
    });

    it('should handle factory errors', async () => {
      const mockError = new Error('Failed to create SimpleAgent');
      const failingAgentFactoryService = {
        create: vi.fn().mockRejectedValue(mockError),
        register: vi.fn(),
      } as any;

      // Recreate template with failing factory service
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SimpleAgentTemplate,
          {
            provide: AgentFactoryService,
            useValue: failingAgentFactoryService,
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
        invokeModelName: 'gpt-5-mini',
      };

      await expect(
        failingTemplate.create(config, connectedNodes, new Map(), {
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
        invokeModelName: 'gpt-5-mini',
      };

      await expect(
        template.create(config, connectedNodes, new Map(), {
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
        invokeModelName: 'gpt-3.5-turbo',
      };

      const result = await template.create(config, connectedNodes, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(result.config).toEqual({
        summarizeMaxTokens: 2000,
        summarizeKeepTokens: 1000,
        instructions: 'Custom instructions',
        name: 'Custom Agent',
        invokeModelName: 'gpt-3.5-turbo',
      });
      expect(result.config).not.toHaveProperty('toolNodeIds');
    });

    it('should return correct result type', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-5-mini',
      };

      const result = await template.create(config, connectedNodes, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(result).toHaveProperty('agent');
      expect(result).toHaveProperty('config');
      expect(result.agent).toBe(mockSimpleAgent);
      expect(typeof result.config).toBe('object');
    });
  });
});
