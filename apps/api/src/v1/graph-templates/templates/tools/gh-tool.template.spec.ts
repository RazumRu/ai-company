import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GhToolGroup } from '../../../agent-tools/tools/common/github/gh-tool-group';
import { IGithubResourceOutput } from '../../../graph-resources/services/github-resource';
import {
  CompiledGraphNode,
  GraphNode,
  GraphNodeInstanceHandle,
  GraphNodeStatus,
  NodeKind,
} from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { GhToolTemplate, GhToolTemplateSchema } from './gh-tool.template';

const makeHandle = <TInstance>(
  instance: TInstance,
): GraphNodeInstanceHandle<TInstance, any> => ({
  provide: async () => instance,
  configure: async () => {},
  destroy: async () => {},
});

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
    handle: makeHandle(options.instance),
    config: options.config ?? {},
    getStatus: options.getStatus || (() => GraphNodeStatus.Idle),
  }) as unknown as CompiledGraphNode<TInstance>;

describe('GhToolTemplate', () => {
  let template: GhToolTemplate;
  let mockGhToolGroup: GhToolGroup;
  let mockGraphRegistry: GraphRegistry;

  beforeEach(async () => {
    mockGhToolGroup = {
      buildTools: vi.fn().mockReturnValue([]),
    } as unknown as GhToolGroup;

    mockGraphRegistry = {
      register: vi.fn(),
      unregister: vi.fn(),
      get: vi.fn(),
      getNode: vi.fn(),
      getNodeInstance: vi.fn(),
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
      expect(parsed).toEqual({ cloneOnly: false });
    });

    it('should accept cloneOnly flag', () => {
      const config = { cloneOnly: true };
      const parsed = GhToolTemplateSchema.parse(config);
      expect(parsed.cloneOnly).toBe(true);
    });

    it('should ignore legacy flags from older configs', () => {
      const config = {
        oldFlag: true,
        anotherExtra: 'value',
      };
      const parsed = GhToolTemplateSchema.parse(config);
      expect(parsed).toEqual({ cloneOnly: false });
    });
  });

  describe('create', () => {
    const mockRuntimeId = 'runtime-1';
    const mockResourceId = 'resource-1';
    const mockGraphId = 'graph-1';
    const mockMetadata = {
      graphId: mockGraphId,
      nodeId: 'tool-1',
      version: '1',
    };

    let mockRuntime: BaseRuntime;
    let mockResource: IGithubResourceOutput;

    beforeEach(() => {
      mockRuntime = {
        exec: vi.fn().mockResolvedValue({
          stdout: '',
          stderr: '',
          exitCode: 0,
          fail: false,
          execPath: '/bin/sh',
        }),
      } as unknown as BaseRuntime;

      mockResource = {
        patToken: 'test-token',
        information: 'Resource info',
        data: {
          env: { GITHUB_PAT_TOKEN: 'test-token' },
          initScript: 'echo init',
        },
      } as any;

      vi.mocked(mockGraphRegistry.filterNodesByType).mockImplementation(
        (_gid, _nodes, kind) =>
          kind === NodeKind.Runtime ? [mockRuntimeId] : [],
      );

      vi.mocked(mockGraphRegistry.filterNodesByTemplate).mockImplementation(
        (_gid, _nodes, templateId) =>
          templateId === 'github-resource' ? [mockResourceId] : [],
      );

      vi.mocked(mockGraphRegistry.getNodeInstance).mockImplementation(
        (_gid, nid) => (nid === mockRuntimeId ? mockRuntime : undefined),
      );

      vi.mocked(mockGraphRegistry.getNode).mockImplementation((_gid, nid) => {
        if (nid === mockResourceId) {
          return buildMockNode({
            id: mockResourceId,
            type: NodeKind.Resource,
            template: 'github-resource',
            instance: mockResource,
          });
        }
        return undefined;
      });
    });

    it('should create GitHub tools with valid runtime and resource nodes', async () => {
      const mockTools = [{ name: 'gh-tool' }] as DynamicStructuredTool[];
      vi.mocked(mockGhToolGroup.buildTools).mockReturnValue(mockTools);

      const outputNodeIds = new Set([mockRuntimeId, mockResourceId]);
      const config = { cloneOnly: false };
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockGhToolGroup.buildTools).toHaveBeenCalledWith(
        expect.objectContaining({
          patToken: 'test-token',
          tools: undefined,
        }),
      );
      expect(instance).toEqual(mockTools);
      expect(mockRuntime.exec).toHaveBeenCalled();
    });

    it('should use cloneOnly flag to limit tools', async () => {
      const outputNodeIds = new Set([mockRuntimeId, mockResourceId]);
      const config = { cloneOnly: true };
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockGhToolGroup.buildTools).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: ['clone'],
        }),
      );
    });

    it('should throw NotFoundException when runtime node not found', async () => {
      vi.mocked(mockGraphRegistry.filterNodesByType).mockReturnValue([]);

      const config = { cloneOnly: false };
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);

      await expect(handle.configure(init, instance)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when runtime node is null', async () => {
      vi.mocked(mockGraphRegistry.getNodeInstance).mockReturnValue(undefined);

      const outputNodeIds = new Set([mockRuntimeId]);
      const config = { cloneOnly: false };
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);

      await expect(handle.configure(init, instance)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when GitHub resource node not found', async () => {
      vi.mocked(mockGraphRegistry.filterNodesByTemplate).mockReturnValue([]);

      const outputNodeIds = new Set([mockRuntimeId]);
      const config = { cloneOnly: false };
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);

      await expect(handle.configure(init, instance)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should execute init script from GitHub resource', async () => {
      const outputNodeIds = new Set([mockRuntimeId, mockResourceId]);
      const config = { cloneOnly: false };
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockRuntime.exec).toHaveBeenCalledWith(
        expect.objectContaining({
          cmd: 'echo init',
          env: expect.objectContaining({ GITHUB_PAT_TOKEN: 'test-token' }),
        }),
      );
    });

    it('should throw BadRequestException when init script fails', async () => {
      vi.mocked(mockRuntime.exec).mockResolvedValue({
        stdout: '',
        stderr: 'Error',
        exitCode: 1,
        fail: true,
        execPath: '/usr/bin/gh',
      });

      const outputNodeIds = new Set([mockRuntimeId, mockResourceId]);
      const config = { cloneOnly: false };
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);

      await expect(handle.configure(init, instance)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should skip init script execution when initScript is undefined', async () => {
      mockResource.data.initScript = undefined;

      const outputNodeIds = new Set([mockRuntimeId, mockResourceId]);
      const config = { cloneOnly: false };
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockRuntime.exec).not.toHaveBeenCalled();
    });
  });
});
