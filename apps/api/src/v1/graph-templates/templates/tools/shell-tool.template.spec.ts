import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellTool } from '../../../agent-tools/tools/shell.tool';
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import {
  ShellToolTemplate,
  ShellToolTemplateSchema,
} from './shell-tool.template';

describe('ShellToolTemplate', () => {
  let template: ShellToolTemplate;
  let mockShellTool: ShellTool;

  beforeEach(async () => {
    mockShellTool = {
      build: vi.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShellToolTemplate,
        {
          provide: ShellTool,
          useValue: mockShellTool,
        },
      ],
    }).compile();

    template = module.get<ShellToolTemplate>(ShellToolTemplate);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('shell-tool');
    });

    it('should have correct description', () => {
      expect(template.description).toBe('Shell execution tool');
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.Tool);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(ShellToolTemplateSchema);
    });
  });

  describe('schema validation', () => {
    it('should validate required runtimeNodeId', () => {
      const validConfig = {
        runtimeNodeId: 'runtime-1',
      };

      expect(() => ShellToolTemplateSchema.parse(validConfig)).not.toThrow();
    });

    it('should reject missing runtimeNodeId', () => {
      const invalidConfig = {};

      expect(() => ShellToolTemplateSchema.parse(invalidConfig)).toThrow();
    });

    it('should accept empty runtimeNodeId (Zod string allows empty)', () => {
      const config = {
        runtimeNodeId: '',
      };

      // Zod string() allows empty strings by default
      expect(() => ShellToolTemplateSchema.parse(config)).not.toThrow();
    });
  });

  describe('create', () => {
    it('should create shell tool with valid runtime node', async () => {
      const mockRuntime = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;
      const mockRuntimeNode: CompiledGraphNode<BaseRuntime> = {
        id: 'runtime-1',
        type: 'runtime',
        instance: mockRuntime,
      };
      const mockTool = { name: 'shell' } as DynamicStructuredTool;

      const compiledNodes = new Map([['runtime-1', mockRuntimeNode]]);
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {
        runtimeNodeId: 'runtime-1',
      };

      const result = await template.create(config, compiledNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
      });
      expect(result).toBe(mockTool);
    });

    it('should throw NotFoundException when runtime node not found', async () => {
      const compiledNodes = new Map(); // Empty map

      const config = {
        runtimeNodeId: 'non-existent-runtime',
      };

      await expect(
        template.create(config, compiledNodes, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException with correct error message', async () => {
      const compiledNodes = new Map();

      const config = {
        runtimeNodeId: 'missing-runtime',
      };

      try {
        await template.create(config, compiledNodes, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        });
        throw new Error('Expected NotFoundException to be thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect(error.message).toContain('Node missing-runtime not found');
      }
    });

    it('should handle shell tool build errors', async () => {
      const mockRuntime = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;
      const mockRuntimeNode: CompiledGraphNode<BaseRuntime> = {
        id: 'runtime-1',
        type: 'runtime',
        instance: mockRuntime,
      };
      const compiledNodes = new Map([['runtime-1', mockRuntimeNode]]);

      const mockError = new Error('Failed to build shell tool');
      mockShellTool.build = vi.fn().mockImplementation(() => {
        throw mockError;
      });

      const config = {
        runtimeNodeId: 'runtime-1',
      };

      await expect(
        template.create(config, compiledNodes, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow('Failed to build shell tool');
    });

    it('should work with different runtime node IDs', async () => {
      const mockRuntime1 = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;
      const mockRuntime2 = {
        id: 'runtime-2',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;

      const mockRuntimeNode1: CompiledGraphNode<BaseRuntime> = {
        id: 'runtime-1',
        type: 'runtime',
        instance: mockRuntime1,
      };

      const mockRuntimeNode2: CompiledGraphNode<BaseRuntime> = {
        id: 'runtime-2',
        type: 'runtime',
        instance: mockRuntime2,
      };

      const compiledNodes = new Map([
        ['runtime-1', mockRuntimeNode1],
        ['runtime-2', mockRuntimeNode2],
      ]);

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      // Test with first runtime
      const config1 = { runtimeNodeId: 'runtime-1' };
      await template.create(config1, compiledNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime1,
      });

      // Test with second runtime
      const config2 = { runtimeNodeId: 'runtime-2' };
      await template.create(config2, compiledNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime2,
      });
    });

    it('should handle null/undefined runtime node gracefully', async () => {
      const compiledNodes = new Map([['runtime-1', undefined as any]]);

      const config = {
        runtimeNodeId: 'runtime-1',
      };

      await expect(
        template.create(config, compiledNodes, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
