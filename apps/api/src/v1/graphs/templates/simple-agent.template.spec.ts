import { DynamicStructuredTool } from '@langchain/core/tools';
import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  SimpleAgent,
  SimpleAgentSchemaType,
} from '../../agents/services/agents/simple-agent';
import { CompiledGraphNode, NodeKind } from '../graphs.types';
import { SimpleAgentTemplateResult } from './base-node.template';
import {
  SimpleAgentTemplate,
  SimpleAgentTemplateSchema,
} from './simple-agent.template';

describe('SimpleAgentTemplate', () => {
  let template: SimpleAgentTemplate;
  let mockModuleRef: ModuleRef;
  let mockSimpleAgent: SimpleAgent;

  beforeEach(async () => {
    mockSimpleAgent = {
      addTool: vi.fn(),
      run: vi.fn(),
      schema: {} as any,
      buildLLM: vi.fn(),
    } as any;

    mockModuleRef = {
      resolve: vi.fn().mockResolvedValue(mockSimpleAgent),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SimpleAgentTemplate,
        {
          provide: ModuleRef,
          useValue: mockModuleRef,
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
        'Simple agent with configurable tools and runtime',
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
        invokeModelName: 'gpt-4',
      };

      expect(() => SimpleAgentTemplateSchema.parse(validConfig)).not.toThrow();
    });

    it('should validate with optional toolNodeIds', () => {
      const validConfig = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-4',
        toolNodeIds: ['tool-1', 'tool-2'],
      };

      expect(() => SimpleAgentTemplateSchema.parse(validConfig)).not.toThrow();
    });

    it('should reject missing required fields', () => {
      const invalidConfig = {
        // missing required SimpleAgent fields
        toolNodeIds: ['tool-1'],
      };

      expect(() => SimpleAgentTemplateSchema.parse(invalidConfig)).toThrow();
    });

    it('should validate empty toolNodeIds array', () => {
      const validConfig = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-4',
        toolNodeIds: [],
      };

      expect(() => SimpleAgentTemplateSchema.parse(validConfig)).not.toThrow();
    });
  });

  describe('create', () => {
    let mockTool1: DynamicStructuredTool;
    let mockTool2: DynamicStructuredTool;
    let mockToolNode1: CompiledGraphNode<DynamicStructuredTool>;
    let mockToolNode2: CompiledGraphNode<DynamicStructuredTool>;
    let compiledNodes: Map<string, CompiledGraphNode>;

    beforeEach(() => {
      mockTool1 = { name: 'tool-1', invoke: vi.fn() } as any;
      mockTool2 = { name: 'tool-2', invoke: vi.fn() } as any;

      mockToolNode1 = {
        id: 'tool-1',
        type: 'tool',
        instance: mockTool1,
      };

      mockToolNode2 = {
        id: 'tool-2',
        type: 'tool',
        instance: mockTool2,
      };

      compiledNodes = new Map([
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
        invokeModelName: 'gpt-4',
      };

      const result = await template.create(config, compiledNodes);

      expect(mockModuleRef.resolve).toHaveBeenCalledWith(SimpleAgent);
      expect(mockSimpleAgent.addTool).not.toHaveBeenCalled();

      expect(result).toEqual({
        agent: mockSimpleAgent,
        config: {
          summarizeMaxTokens: 1000,
          summarizeKeepTokens: 500,
          instructions: 'Test agent instructions',
          name: 'Test Agent',
          invokeModelName: 'gpt-4',
        },
      });
    });

    it('should create simple agent with empty toolNodeIds', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-4',
        toolNodeIds: [],
      };

      const result = await template.create(config, compiledNodes);

      expect(mockSimpleAgent.addTool).not.toHaveBeenCalled();
      expect(result.config).not.toHaveProperty('toolNodeIds');
    });

    it('should create simple agent with tools', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-4',
        toolNodeIds: ['tool-1', 'tool-2'],
      };

      const result = await template.create(config, compiledNodes);

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
          invokeModelName: 'gpt-4',
        },
      });
    });

    it('should handle missing tool nodes gracefully', async () => {
      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-4',
        toolNodeIds: ['tool-1', 'non-existent-tool', 'tool-2'],
      };

      const result = await template.create(config, compiledNodes);

      // Should only add existing tools (compact removes undefined values)
      expect(mockSimpleAgent.addTool).toHaveBeenCalledTimes(2);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(mockTool1);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(mockTool2);
    });

    it('should handle partial tool availability', async () => {
      const partialCompiledNodes = new Map([
        ['tool-1', mockToolNode1],
        // tool-2 is missing
      ]);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-4',
        toolNodeIds: ['tool-1', 'tool-2'],
      };

      const result = await template.create(config, partialCompiledNodes);

      // Should only add available tools
      expect(mockSimpleAgent.addTool).toHaveBeenCalledTimes(1);
      expect(mockSimpleAgent.addTool).toHaveBeenCalledWith(mockTool1);
    });

    it('should handle module resolution errors', async () => {
      const mockError = new Error('Failed to resolve SimpleAgent');
      mockModuleRef.resolve = vi.fn().mockRejectedValue(mockError);

      const config = {
        summarizeMaxTokens: 1000,
        summarizeKeepTokens: 500,
        instructions: 'Test agent instructions',
        name: 'Test Agent',
        invokeModelName: 'gpt-4',
      };

      await expect(template.create(config, compiledNodes)).rejects.toThrow(
        'Failed to resolve SimpleAgent',
      );
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
        invokeModelName: 'gpt-4',
        toolNodeIds: ['tool-1'],
      };

      await expect(template.create(config, compiledNodes)).rejects.toThrow(
        'Failed to add tool',
      );
    });

    it('should preserve original config structure', async () => {
      const config = {
        summarizeMaxTokens: 2000,
        summarizeKeepTokens: 1000,
        instructions: 'Custom instructions',
        name: 'Custom Agent',
        invokeModelName: 'gpt-3.5-turbo',
        toolNodeIds: ['tool-1'],
      };

      const result = await template.create(config, compiledNodes);

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
        invokeModelName: 'gpt-4',
      };

      const result = await template.create(config, compiledNodes);

      expect(result).toHaveProperty('agent');
      expect(result).toHaveProperty('config');
      expect(result.agent).toBe(mockSimpleAgent);
      expect(typeof result.config).toBe('object');
    });
  });
});
