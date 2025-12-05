import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellTool } from '../../../agent-tools/tools/core/shell.tool';
import {
  IShellResourceOutput,
  ResourceKind,
} from '../../../graph-resources/graph-resources.types';
import {
  CompiledGraphNode,
  GraphNodeStatus,
  NodeKind,
} from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import {
  ShellToolTemplate,
  ShellToolTemplateSchema,
} from './shell-tool.template';

const buildMockNode = <TInstance = unknown>(options: {
  id: string;
  type: NodeKind;
  template: string;
  instance: TInstance;
  config?: unknown;
  getStatus?: () => GraphNodeStatus;
}): CompiledGraphNode<TInstance> =>
  ({
    ...options,
    config: options.config ?? {},
    getStatus: options.getStatus || (() => GraphNodeStatus.Idle),
  }) as unknown as CompiledGraphNode<TInstance>;

describe('ShellToolTemplate', () => {
  let template: ShellToolTemplate;
  let mockShellTool: ShellTool;
  let mockGraphRegistry: GraphRegistry;

  beforeEach(async () => {
    mockShellTool = {
      build: vi.fn(),
    } as unknown as ShellTool;

    mockGraphRegistry = {
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      getNode: vi.fn(),
      filterNodesByType: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GraphRegistry;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShellToolTemplate,
        {
          provide: ShellTool,
          useValue: mockShellTool,
        },
        {
          provide: GraphRegistry,
          useValue: mockGraphRegistry,
        },
      ],
    }).compile();

    template = module.get<ShellToolTemplate>(ShellToolTemplate);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('Shell');
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
        exec: vi
          .fn()
          .mockResolvedValue({ stdout: 'ok', stderr: '', fail: false }),
      } as unknown as BaseRuntime;
      const mockRuntimeNode = buildMockNode<BaseRuntime>({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: false,
        },
      });
      const mockTool = { name: 'shell' } as DynamicStructuredTool;

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockImplementation((_graphId, nodeIds, type) => {
          if (type === NodeKind.Runtime)
            return Array.from(nodeIds).filter((id) => id === 'runtime-1');
          return [];
        });
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          return undefined;
        });
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};
      const outputNodeIds = new Set(['runtime-1']);

      const result = await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockGraphRegistry.filterNodesByType).toHaveBeenCalledWith(
        'test-graph',
        outputNodeIds,
        NodeKind.Runtime,
      );
      expect(mockGraphRegistry.getNode).toHaveBeenCalledWith(
        'test-graph',
        'runtime-1',
      );
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {},
        }),
      );
      expect(result).toEqual([mockTool]);
    });

    it('should throw NotFoundException when runtime node not found', async () => {
      mockGraphRegistry.filterNodesByType = vi.fn().mockReturnValue([]); // No runtime IDs

      const config = {};
      const outputNodeIds = new Set(['non-existent-runtime']);

      await expect(
        template.create(config, new Set(), outputNodeIds, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException with correct error message', async () => {
      mockGraphRegistry.filterNodesByType = vi.fn().mockReturnValue([]); // No runtime IDs

      const config = {};
      const outputNodeIds = new Set(['non-existent-runtime']);

      try {
        await template.create(config, new Set(), outputNodeIds, {
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
      const mockRuntimeNode = buildMockNode<BaseRuntime>({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: false,
        },
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-1']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(mockRuntimeNode);

      const mockError = new Error('Failed to build shell tool');
      mockShellTool.build = vi.fn().mockImplementation(() => {
        throw mockError;
      });

      const config = {};
      const outputNodeIds = new Set(['runtime-1']);

      await expect(
        template.create(config, new Set(), outputNodeIds, {
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

      const mockRuntimeNode1 = buildMockNode<BaseRuntime>({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime1,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: false,
        },
      });

      const mockRuntimeNode2 = buildMockNode<BaseRuntime>({
        id: 'runtime-2',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime2,
        config: {
          runtimeType: 'docker' as const,
          image: 'python:3.11',
          enableDind: true,
        },
      });

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      // Test with first runtime
      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-1']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(mockRuntimeNode1);

      const config1 = {};
      const outputNodeIds1 = new Set(['runtime-1']);
      await template.create(config1, new Set(), outputNodeIds1, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {},
        }),
      );

      // Test with second runtime
      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-2']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(mockRuntimeNode2);

      const config2 = {};
      const outputNodeIds2 = new Set(['runtime-2']);
      await template.create(config2, new Set(), outputNodeIds2, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {},
        }),
      );
    });

    it('should handle null/undefined runtime node gracefully', async () => {
      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-1']);
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(undefined);

      const config = {};
      const outputNodeIds = new Set(['runtime-1']);

      await expect(
        template.create(config, new Set(), outputNodeIds, {
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
      const mockRuntimeNode = buildMockNode<BaseRuntime>({
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
      });

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
      const mockResourceNode = buildMockNode<IShellResourceOutput>({
        id: 'resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        config: {},
        instance: mockResourceOutput,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockImplementation((graphId, nodeIds, type) => {
          if (type === NodeKind.Runtime) {
            return ['runtime-1'];
          }
          if (type === NodeKind.Resource) {
            return ['resource-1'];
          }
          return [];
        });
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          if (nodeId === 'resource-1') return mockResourceNode;
          return undefined;
        });

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};
      const outputNodeIds = new Set(['runtime-1', 'resource-1']);

      const result = await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
        }),
      );
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
        }),
      );
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
        }),
      );
      expect(result).toEqual([mockTool]);
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
      const mockRuntimeNode = buildMockNode<BaseRuntime>({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: false,
        },
      });

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
      const mockResourceNode = buildMockNode<IShellResourceOutput>({
        id: 'resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        config: {},
        instance: mockResourceOutput,
      });

      const mockToolNode = buildMockNode({
        id: 'tool-1',
        type: NodeKind.Tool,
        template: 'web-search-tool',
        config: {},
        instance: {} as DynamicStructuredTool,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockImplementation((graphId, nodeIds, type) => {
          if (type === NodeKind.Runtime) {
            return ['runtime-1'];
          }
          if (type === NodeKind.Resource) {
            return ['resource-1']; // Only resource, not tool
          }
          return [];
        });
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          if (nodeId === 'resource-1') return mockResourceNode;
          if (nodeId === 'tool-1') return mockToolNode;
          return undefined;
        });

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};
      const outputNodeIds = new Set(['runtime-1', 'resource-1', 'tool-1']);

      const result = await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
        }),
      );
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
        }),
      );
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
        }),
      );
      expect(result).toEqual([mockTool]);
    });

    it('should handle missing resource nodes gracefully', async () => {
      const mockRuntime = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;
      const mockRuntimeNode = buildMockNode<BaseRuntime>({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: false,
        },
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockImplementation((graphId, nodeIds, type) => {
          if (type === NodeKind.Runtime) {
            return ['runtime-1'];
          }
          if (type === NodeKind.Resource) {
            return []; // No resources
          }
          return [];
        });
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          return undefined;
        });

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};
      const outputNodeIds = new Set(['runtime-1']);

      const result = await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {}, // Empty object since resource doesn't exist
        }),
      );
      expect(result).toEqual([mockTool]);
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
      const mockRuntimeNode = buildMockNode<BaseRuntime>({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: false,
        },
      });

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
      const mockResourceNode = buildMockNode<IShellResourceOutput>({
        id: 'resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        config: {},
        instance: mockResourceOutput,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockImplementation((graphId, nodeIds, type) => {
          if (type === NodeKind.Runtime) {
            return ['runtime-1'];
          }
          if (type === NodeKind.Resource) {
            return ['resource-1'];
          }
          return [];
        });
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          if (nodeId === 'resource-1') return mockResourceNode;
          return undefined;
        });

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};
      const outputNodeIds = new Set(['runtime-1', 'resource-1']);

      await template.create(config, new Set(), outputNodeIds, {
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

      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
        }),
      );
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
        }),
      );
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
          },
        }),
      );
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
      const mockRuntimeNode = buildMockNode<BaseRuntime>({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
        config: {
          runtimeType: 'docker' as const,
          image: 'node:18',
          enableDind: true,
        },
      });

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

      const mockResourceNode1 = {
        id: 'resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        config: {},
        instance: mockResource1,
      };

      const mockResourceNode2 = {
        id: 'resource-2',
        type: NodeKind.Resource,
        template: 'api-resource',
        config: {},
        instance: mockResource2,
      };

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockImplementation((graphId, nodeIds, type) => {
          if (type === NodeKind.Runtime) {
            return ['runtime-1'];
          }
          if (type === NodeKind.Resource) {
            return ['resource-1', 'resource-2'];
          }
          return [];
        });
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          if (nodeId === 'resource-1') return mockResourceNode1;
          if (nodeId === 'resource-2') return mockResourceNode2;
          return undefined;
        });

      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      mockShellTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};
      const outputNodeIds = new Set(['runtime-1', 'resource-1', 'resource-2']);

      await template.create(config, new Set(), outputNodeIds, {
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

      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
            API_KEY: 'api_key',
          },
        }),
      );
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
            API_KEY: 'api_key',
          },
        }),
      );
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
            API_KEY: 'api_key',
          },
        }),
      );
      expect(mockShellTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          env: {
            GITHUB_PAT_TOKEN: 'ghp_token',
            API_KEY: 'api_key',
          },
        }),
      );
    });
  });
});
