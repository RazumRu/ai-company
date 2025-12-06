import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GhToolGroup } from '../../../agent-tools/tools/common/github/gh-tool-group';
import { IGithubResourceResourceOutput } from '../../../graph-resources/services/github-resource';
import {
  CompiledGraphNode,
  GraphNodeStatus,
  NodeKind,
} from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { GhToolTemplate, GhToolTemplateSchema } from './gh-tool.template';

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

describe('GhToolTemplate', () => {
  let template: GhToolTemplate;
  let mockGhToolGroup: GhToolGroup;
  let mockGraphRegistry: GraphRegistry;

  beforeEach(async () => {
    mockGhToolGroup = {
      buildTools: vi.fn(),
    } as unknown as GhToolGroup;

    mockGraphRegistry = {
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      getNode: vi.fn(),
      filterNodesByType: vi.fn(),
      filterNodesByTemplate: vi.fn(),
      destroy: vi.fn(),
    } as unknown as GraphRegistry;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GhToolTemplate,
        {
          provide: GhToolGroup,
          useValue: mockGhToolGroup,
        },
        {
          provide: GraphRegistry,
          useValue: mockGraphRegistry,
        },
      ],
    }).compile();

    template = module.get<GhToolTemplate>(GhToolTemplate);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('GitHub Tools');
    });

    it('should have correct description', () => {
      expect(template.description).toBe('GitHub tools');
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.Tool);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(GhToolTemplateSchema);
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
          multiple: false,
          required: true,
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
    it('should accept empty config (uses defaults)', () => {
      const config = {};

      const parsed = GhToolTemplateSchema.parse(config);
      expect(parsed.cloneOnly).toBe(false);
    });

    it('should accept cloneOnly flag', () => {
      const config = { cloneOnly: true };

      const parsed = GhToolTemplateSchema.parse(config);
      expect(parsed.cloneOnly).toBe(true);
    });

    it('should ignore legacy flags from older configs', () => {
      const config = {
        includeClone: true,
        includeBranch: true,
        includeCommit: false,
      };

      const parsed = GhToolTemplateSchema.parse(config);
      expect(parsed.cloneOnly).toBe(false);
      expect(parsed).not.toHaveProperty('includeClone');
      expect(parsed).not.toHaveProperty('includeBranch');
      expect(parsed).not.toHaveProperty('includeCommit');
    });
  });

  describe('create', () => {
    it('should create GitHub tools with valid runtime and resource nodes', async () => {
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
      });

      const mockGhResource: IGithubResourceResourceOutput = {
        patToken: 'ghp_test_token',
        information: 'GitHub resource',
        kind: 'Shell' as any,
        data: {
          env: {},
          initScript: undefined,
          initScriptTimeout: undefined,
        },
      };
      const mockGhResourceNode = buildMockNode<IGithubResourceResourceOutput>({
        id: 'github-resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        instance: mockGhResource,
      });

      const mockTools = [{ name: 'gh_clone' } as DynamicStructuredTool];

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockImplementation((_graphId, nodeIds, type) => {
          if (type === NodeKind.Runtime)
            return Array.from(nodeIds).filter((id) => id === 'runtime-1');
          return [];
        });
      mockGraphRegistry.filterNodesByTemplate = vi
        .fn()
        .mockImplementation((_graphId, nodeIds, template) => {
          if (template === 'github-resource')
            return Array.from(nodeIds).filter(
              (id) => id === 'github-resource-1',
            );
          return [];
        });
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          if (nodeId === 'github-resource-1') return mockGhResourceNode;
          return undefined;
        });
      mockGhToolGroup.buildTools = vi.fn().mockReturnValue(mockTools);

      const config = {};
      const outputNodeIds = new Set(['runtime-1', 'github-resource-1']);

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
      expect(mockGraphRegistry.filterNodesByTemplate).toHaveBeenCalledWith(
        'test-graph',
        outputNodeIds,
        'github-resource',
      );
      expect(mockGraphRegistry.getNode).toHaveBeenCalledWith(
        'test-graph',
        'runtime-1',
      );
      expect(mockGraphRegistry.getNode).toHaveBeenCalledWith(
        'test-graph',
        'github-resource-1',
      );
      expect(mockGhToolGroup.buildTools).toHaveBeenCalledWith({
        runtime: expect.any(Function),
        patToken: 'ghp_test_token',
        tools: undefined,
      });
      expect(result).toEqual(mockTools);
    });

    it('should use cloneOnly flag to limit tools', async () => {
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
      });

      const mockGhResource: IGithubResourceResourceOutput = {
        patToken: 'ghp_test_token',
        information: 'GitHub resource',
        kind: 'Shell' as any,
        data: {
          env: {},
          initScript: undefined,
          initScriptTimeout: undefined,
        },
      };
      const mockGhResourceNode = buildMockNode<IGithubResourceResourceOutput>({
        id: 'github-resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        instance: mockGhResource,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockImplementation((_graphId, nodeIds, type) => {
          if (type === NodeKind.Runtime)
            return Array.from(nodeIds).filter((id) => id === 'runtime-1');
          return [];
        });
      mockGraphRegistry.filterNodesByTemplate = vi
        .fn()
        .mockImplementation((_graphId, nodeIds, template) => {
          if (template === 'github-resource')
            return Array.from(nodeIds).filter(
              (id) => id === 'github-resource-1',
            );
          return [];
        });
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          if (nodeId === 'github-resource-1') return mockGhResourceNode;
          return undefined;
        });
      mockGhToolGroup.buildTools = vi.fn().mockReturnValue([]);

      const config = {
        cloneOnly: true,
      };
      const outputNodeIds = new Set(['runtime-1', 'github-resource-1']);

      await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockGhToolGroup.buildTools).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          patToken: 'ghp_test_token',
          tools: ['clone'],
        }),
      );
    });

    it('should throw NotFoundException when runtime node not found', async () => {
      mockGraphRegistry.filterNodesByType = vi.fn().mockReturnValue([]);

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

    it('should throw NotFoundException when runtime node is null', async () => {
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
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when GitHub resource node not found', async () => {
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
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-1']);
      mockGraphRegistry.filterNodesByTemplate = vi.fn().mockReturnValue([]);
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          return undefined;
        });

      const config = {};
      const outputNodeIds = new Set(['runtime-1']);

      await expect(
        template.create(config, new Set(), outputNodeIds, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should execute init script from GitHub resource', async () => {
      const mockRuntime = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn().mockResolvedValue({
          stdout: 'init completed',
          stderr: '',
          exitCode: 0,
          fail: false,
          execPath: '/runtime-workspace/test-thread',
        }),
      } as unknown as BaseRuntime;
      const mockRuntimeNode = buildMockNode<BaseRuntime>({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
      });

      const mockGhResource: IGithubResourceResourceOutput = {
        patToken: 'ghp_test_token',
        information: 'GitHub resource',
        kind: 'Shell' as any,
        data: {
          env: { GITHUB_PAT_TOKEN: 'ghp_test_token' },
          initScript: ['echo "setup"', 'gh config set git_protocol https'],
          initScriptTimeout: 60000,
        },
      };
      const mockGhResourceNode = buildMockNode<IGithubResourceResourceOutput>({
        id: 'github-resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        instance: mockGhResource,
      });

      const mockTools = [{ name: 'gh_clone' } as DynamicStructuredTool];

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-1']);
      mockGraphRegistry.filterNodesByTemplate = vi
        .fn()
        .mockReturnValue(['github-resource-1']);
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          if (nodeId === 'github-resource-1') return mockGhResourceNode;
          return undefined;
        });
      mockGhToolGroup.buildTools = vi.fn().mockReturnValue(mockTools);

      const config = {};
      const outputNodeIds = new Set(['runtime-1', 'github-resource-1']);

      await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockRuntime.exec).toHaveBeenCalledWith({
        cmd: ['echo "setup"', 'gh config set git_protocol https'],
        timeoutMs: 60000,
        env: { GITHUB_PAT_TOKEN: 'ghp_test_token' },
      });
      expect(mockGhToolGroup.buildTools).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          patToken: 'ghp_test_token',
          tools: undefined,
        }),
      );
    });

    it('should throw BadRequestException when init script fails', async () => {
      const mockRuntime = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn().mockResolvedValue({
          stdout: '',
          stderr: 'Init script failed',
          exitCode: 1,
          fail: true,
          execPath: '/runtime-workspace/test-thread',
        }),
      } as unknown as BaseRuntime;
      const mockRuntimeNode = buildMockNode<BaseRuntime>({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime,
      });

      const mockGhResource: IGithubResourceResourceOutput = {
        patToken: 'ghp_test_token',
        information: 'GitHub resource',
        kind: 'Shell' as any,
        data: {
          env: {},
          initScript: ['echo "setup"'],
          initScriptTimeout: 60000,
        },
      };
      const mockGhResourceNode = buildMockNode<IGithubResourceResourceOutput>({
        id: 'github-resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        instance: mockGhResource,
      });

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-1']);
      mockGraphRegistry.filterNodesByTemplate = vi
        .fn()
        .mockReturnValue(['github-resource-1']);
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          if (nodeId === 'github-resource-1') return mockGhResourceNode;
          return undefined;
        });

      const config = {};
      const outputNodeIds = new Set(['runtime-1', 'github-resource-1']);

      await expect(
        template.create(config, new Set(), outputNodeIds, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should skip init script execution when initScript is undefined', async () => {
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
      });

      const mockGhResource: IGithubResourceResourceOutput = {
        patToken: 'ghp_test_token',
        information: 'GitHub resource',
        kind: 'Shell' as any,
        data: {
          env: {},
          initScript: undefined,
          initScriptTimeout: undefined,
        },
      };
      const mockGhResourceNode = buildMockNode<IGithubResourceResourceOutput>({
        id: 'github-resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        instance: mockGhResource,
      });

      const mockTools = [{ name: 'gh_clone' } as DynamicStructuredTool];

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-1']);
      mockGraphRegistry.filterNodesByTemplate = vi
        .fn()
        .mockReturnValue(['github-resource-1']);
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          if (nodeId === 'github-resource-1') return mockGhResourceNode;
          return undefined;
        });
      mockGhToolGroup.buildTools = vi.fn().mockReturnValue(mockTools);

      const config = {};
      const outputNodeIds = new Set(['runtime-1', 'github-resource-1']);

      await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockRuntime.exec).not.toHaveBeenCalled();
      expect(mockGhToolGroup.buildTools).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          patToken: 'ghp_test_token',
          tools: undefined,
        }),
      );
    });

    it('should use runtime getter function that fetches fresh instance', async () => {
      const mockRuntime1 = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;
      const mockRuntime2 = {
        id: 'runtime-1',
        start: vi.fn(),
        stop: vi.fn(),
        exec: vi.fn(),
      } as unknown as BaseRuntime;

      const mockRuntimeNode1 = buildMockNode<BaseRuntime>({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime1,
      });
      const mockRuntimeNode2 = buildMockNode<BaseRuntime>({
        id: 'runtime-1',
        type: NodeKind.Runtime,
        template: 'docker-runtime',
        instance: mockRuntime2,
      });

      const mockGhResource: IGithubResourceResourceOutput = {
        patToken: 'ghp_test_token',
        information: 'GitHub resource',
        kind: 'Shell' as any,
        data: {
          env: {},
          initScript: undefined,
          initScriptTimeout: undefined,
        },
      };
      const mockGhResourceNode = buildMockNode<IGithubResourceResourceOutput>({
        id: 'github-resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        instance: mockGhResource,
      });

      const mockTools = [{ name: 'gh_clone' } as DynamicStructuredTool];

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-1']);
      mockGraphRegistry.filterNodesByTemplate = vi
        .fn()
        .mockReturnValue(['github-resource-1']);
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode1;
          if (nodeId === 'github-resource-1') return mockGhResourceNode;
          return undefined;
        });
      mockGhToolGroup.buildTools = vi.fn().mockReturnValue(mockTools);

      const config = {};
      const outputNodeIds = new Set(['runtime-1', 'github-resource-1']);

      await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      // Verify that buildTools was called with a runtime getter function
      expect(mockGhToolGroup.buildTools).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: expect.any(Function),
          patToken: 'ghp_test_token',
          tools: undefined,
        }),
      );

      // Verify that the runtime getter function fetches from registry
      const runtimeGetter = (mockGhToolGroup.buildTools as any).mock
        .calls[0]![0].runtime;
      expect(typeof runtimeGetter).toBe('function');

      // Update registry to return different runtime instance
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode2;
          if (nodeId === 'github-resource-1') return mockGhResourceNode;
          return undefined;
        });

      // Call the runtime getter - it should fetch fresh instance
      const runtimeInstance = runtimeGetter();
      expect(runtimeInstance).toBe(mockRuntime2);
    });

    it('should throw NotFoundException when runtime getter cannot find runtime', async () => {
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
      });

      const mockGhResource: IGithubResourceResourceOutput = {
        patToken: 'ghp_test_token',
        information: 'GitHub resource',
        kind: 'Shell' as any,
        data: {
          env: {},
          initScript: undefined,
          initScriptTimeout: undefined,
        },
      };
      const mockGhResourceNode = buildMockNode<IGithubResourceResourceOutput>({
        id: 'github-resource-1',
        type: NodeKind.Resource,
        template: 'github-resource',
        instance: mockGhResource,
      });

      const mockTools = [{ name: 'gh_clone' } as DynamicStructuredTool];

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-1']);
      mockGraphRegistry.filterNodesByTemplate = vi
        .fn()
        .mockReturnValue(['github-resource-1']);
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          if (nodeId === 'github-resource-1') return mockGhResourceNode;
          return undefined;
        });
      mockGhToolGroup.buildTools = vi.fn().mockReturnValue(mockTools);

      const config = {};
      const outputNodeIds = new Set(['runtime-1', 'github-resource-1']);

      await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      // Verify runtime getter was created
      const runtimeGetter = (mockGhToolGroup.buildTools as any).mock
        .calls[0]![0].runtime;

      // Remove runtime from registry
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(undefined);

      // Call runtime getter - should throw NotFoundException
      expect(() => runtimeGetter()).toThrow(NotFoundException);
    });
  });
});
