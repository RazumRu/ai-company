import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellTool } from '../../../agent-tools/tools/shell.tool';
import {
  IShellResourceOutput,
  ResourceKind,
} from '../../../graph-resources/graph-resources.types';
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
    } as unknown as ShellTool;

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
      expect(template.description).toBe(
        'Execute shell commands in the selected runtime',
      );
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.Tool);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(ShellToolTemplateSchema);
    });

    it('should have correct inputs', () => {
      expect(template.inputs).toEqual([
        {
          type: 'kind',
          value: NodeKind.SimpleAgent,
          multiple: true,
        },
      ]);
    });

    it('should have correct outputs', () => {
      expect(template.outputs).toEqual([
        {
          type: 'template',
          value: 'github-resource',
          multiple: true,
        },
        {
          type: 'kind',
          value: NodeKind.Runtime,
          required: true,
          multiple: false,
        },
      ]);
    });
  });

  describe('schema validation', () => {
    it('should accept empty config (no parameters needed)', () => {
      const config = {};

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
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          workdir: '/app',
          enableDind: false,
        },
      };
      const mockTool = { name: 'shell' } as DynamicStructuredTool;

      const connectedNodes = new Map<string, CompiledGraphNode>([
        ['runtime-1', mockRuntimeNode],
      ]);
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};

      const result = await template.create(config, new Map(), connectedNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {},
        additionalInfo: expect.stringContaining('Runtime Configuration:'),
      });
      expect(result).toBe(mockTool);
    });

    it('should throw NotFoundException when runtime node not found', async () => {
      const connectedNodes = new Map(); // Empty map

      const config = {};

      await expect(
        template.create(config, new Map(), connectedNodes, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException with correct error message', async () => {
      const connectedNodes = new Map();

      const config = {};

      try {
        await template.create(config, new Map(), connectedNodes, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        });
        throw new Error('Expected NotFoundException to be thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).message).toContain(
          'Runtime node not found in output nodes',
        );
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
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: false,
        },
      };
      const connectedNodes = new Map<string, CompiledGraphNode>([
        ['runtime-1', mockRuntimeNode],
      ]);

      const mockError = new Error('Failed to build shell tool');
      mockShellTool.build = vi.fn().mockImplementation(() => {
        throw mockError;
      });

      const config = {};

      await expect(
        template.create(config, new Map(), connectedNodes, {
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
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime1,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: false,
        },
      };

      const mockRuntimeNode2: CompiledGraphNode<BaseRuntime> = {
        id: 'runtime-2',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime2,
        config: {
          runtimeType: 'docker' as const,
          image: 'python:3.11',
          enableDind: true,
        },
      };

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      // Test with first runtime
      const connectedNodes1 = new Map<string, CompiledGraphNode>([
        ['runtime-1', mockRuntimeNode1],
      ]);
      const config1 = {};
      await template.create(config1, new Map(), connectedNodes1, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime1,
        env: {},
        additionalInfo: expect.stringContaining('Runtime Configuration:'),
      });

      // Test with second runtime
      const connectedNodes2 = new Map<string, CompiledGraphNode>([
        ['runtime-2', mockRuntimeNode2],
      ]);
      const config2 = {};
      await template.create(config2, new Map(), connectedNodes2, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime2,
        env: {},
        additionalInfo: expect.stringContaining('Runtime Configuration:'),
      });
    });

    it('should handle null/undefined runtime node gracefully', async () => {
      const connectedNodes = new Map<string, CompiledGraphNode>([
        ['runtime-1', undefined as unknown as CompiledGraphNode],
      ]);

      const config = {};

      await expect(
        template.create(config, new Map(), connectedNodes, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow();
    });

    it('should create shell tool with resources', async () => {
      const mockRuntime = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn().mockResolvedValue({
          stdout: 'init completed',
          stderr: '',
          exitCode: 0,
          fail: false,
        }),
      } as unknown as BaseRuntime;
      const mockRuntimeNode: CompiledGraphNode<BaseRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          workdir: '/app',
          enableDind: false,
        },
      };

      const mockResourceOutput: IShellResourceOutput = {
        information: 'GitHub resource information',
        kind: ResourceKind.Shell,
        data: {
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
          initScript: ['echo "setup"'],
          initScriptTimeout: 60000,
        },
      };
      const mockResourceNode: CompiledGraphNode<IShellResourceOutput> = {
        id: 'resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        config: {},
        instance: mockResourceOutput,
      };

      const connectedNodes = new Map<string, CompiledGraphNode>([
        ['runtime-1', mockRuntimeNode],
        ['resource-1', mockResourceNode],
      ]);

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};

      const result = await template.create(config, new Map(), connectedNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
        },
        additionalInfo: expect.stringContaining('Runtime Configuration:'),
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
        },
        additionalInfo: expect.stringContaining('Available Resources:'),
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
        },
        additionalInfo: expect.stringContaining('GitHub resource information'),
      });
      expect(result).toBe(mockTool);
    });

    it('should ignore non-resource nodes in resourceNodeIds', async () => {
      const mockRuntime = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn().mockResolvedValue({
          stdout: 'init completed',
          stderr: '',
          exitCode: 0,
          fail: false,
        }),
      } as unknown as BaseRuntime;
      const mockRuntimeNode: CompiledGraphNode<BaseRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: false,
        },
      };

      const mockResourceOutput: IShellResourceOutput = {
        information: 'GitHub resource information',
        kind: ResourceKind.Shell,
        data: {
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
          initScript: ['echo "setup"'],
          initScriptTimeout: 60000,
        },
      };
      const mockResourceNode: CompiledGraphNode<IShellResourceOutput> = {
        id: 'resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        config: {},
        instance: mockResourceOutput,
      };

      const mockToolNode: CompiledGraphNode = {
        id: 'tool-1',
        type: NodeKind.Tool,
        template: 'web-search-tool',
        config: {},
        instance: {} as DynamicStructuredTool,
      };

      const connectedNodes = new Map<string, CompiledGraphNode>([
        ['runtime-1', mockRuntimeNode],
        ['resource-1', mockResourceNode],
        ['tool-1', mockToolNode],
      ]);

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};

      const result = await template.create(config, new Map(), connectedNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
        },
        additionalInfo: expect.stringContaining('Runtime Configuration:'),
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
        },
        additionalInfo: expect.stringContaining('Available Resources:'),
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
        },
        additionalInfo: expect.stringContaining('GitHub resource information'),
      });
      expect(result).toBe(mockTool);
    });

    it('should handle missing resource nodes gracefully', async () => {
      const mockRuntime = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;
      const mockRuntimeNode: CompiledGraphNode<BaseRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: false,
        },
      };

      const connectedNodes = new Map<string, CompiledGraphNode>([
        ['runtime-1', mockRuntimeNode],
      ]);

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};

      const result = await template.create(config, new Map(), connectedNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {}, // Empty object since resource doesn't exist
        additionalInfo: expect.stringContaining('Runtime Configuration:'),
      });
      expect(result).toBe(mockTool);
    });

    it('should execute init scripts from resources', async () => {
      const mockRuntime = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn().mockResolvedValue({
          stdout: 'init completed',
          stderr: '',
          exitCode: 0,
        }),
      } as unknown as BaseRuntime;
      const mockRuntimeNode: CompiledGraphNode<BaseRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: false,
        },
      };

      const mockResourceOutput: IShellResourceOutput = {
        information: 'GitHub resource information',
        kind: ResourceKind.Shell,
        data: {
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
          initScript: ['echo "setup"', 'apt-get update'],
          initScriptTimeout: 60000,
        },
      };
      const mockResourceNode: CompiledGraphNode<IShellResourceOutput> = {
        id: 'resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        config: {},
        instance: mockResourceOutput,
      };

      const connectedNodes = new Map<string, CompiledGraphNode>([
        ['runtime-1', mockRuntimeNode],
        ['resource-1', mockResourceNode],
      ]);

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};

      await template.create(config, new Map(), connectedNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      // Verify that init scripts were executed
      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: ['echo "setup"', 'apt-get update'],
        timeoutMs: 60000,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
        },
      });

      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
        },
        additionalInfo: expect.stringContaining('Runtime Configuration:'),
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
        },
        additionalInfo: expect.stringContaining('Available Resources:'),
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
        },
        additionalInfo: expect.stringContaining('GitHub resource information'),
      });
    });

    it('should handle multiple resources with different init scripts', async () => {
      const mockRuntime = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn().mockResolvedValue({
          stdout: 'init completed',
          stderr: '',
          exitCode: 0,
        }),
      } as unknown as BaseRuntime;
      const mockRuntimeNode: CompiledGraphNode<BaseRuntime> = {
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: true,
        },
      };

      const mockResource1: IShellResourceOutput = {
        information: 'GitHub resource',
        kind: ResourceKind.Shell,
        data: {
          env: { GITHUB_PAT_TOKEN: 'ghp_token' },
          initScript: ['echo "github setup"'],
          initScriptTimeout: 60000,
        },
      };
      const mockResource2: IShellResourceOutput = {
        information: 'Another resource',
        kind: ResourceKind.Shell,
        data: {
          env: { API_KEY: 'api_key' },
          initScript: ['echo "api setup"', 'npm install'],
          initScriptTimeout: 60000,
        },
      };

      const connectedNodes = new Map<string, CompiledGraphNode>([
        ['runtime-1', mockRuntimeNode],
        [
          'resource-1',
          {
            id: 'resource-1',
            type: NodeKind.Resource,
            template: 'github-resource',
            config: {},
            instance: mockResource1,
          },
        ],
        [
          'resource-2',
          {
            id: 'resource-2',
            type: NodeKind.Resource,
            template: 'api-resource',
            config: {},
            instance: mockResource2,
          },
        ],
      ]);

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};

      await template.create(config, new Map(), connectedNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      // Verify that init scripts were executed separately
      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: ['echo "github setup"'],
        timeoutMs: 60000,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
          API_KEY: 'api_key',
        },
      });
      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: ['echo "api setup"', 'npm install'],
        timeoutMs: 60000,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
          API_KEY: 'api_key',
        },
      });

      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
          API_KEY: 'api_key',
        },
        additionalInfo: expect.stringContaining('Runtime Configuration:'),
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
          API_KEY: 'api_key',
        },
        additionalInfo: expect.stringContaining('Available Resources:'),
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
          API_KEY: 'api_key',
        },
        additionalInfo: expect.stringContaining('GitHub resource'),
      });
      expect(mockShellTool.build).toHaveBeenCalledWith({
        runtime: mockRuntime,
        env: {
          GITHUB_PAT_TOKEN: 'ghp_token',
          API_KEY: 'api_key',
        },
        additionalInfo: expect.stringContaining('Another resource'),
      });
    });
  });
});
