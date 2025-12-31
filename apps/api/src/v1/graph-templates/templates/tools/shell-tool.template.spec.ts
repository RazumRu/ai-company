import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellTool } from '../../../agent-tools/tools/common/shell.tool';
import {
  IShellResourceOutput,
  ResourceKind,
} from '../../../graph-resources/graph-resources.types';
import {
  CompiledGraphNode,
  GraphNode,
  GraphNodeInstanceHandle,
  GraphNodeStatus,
  NodeKind,
} from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import {
  ShellToolTemplate,
  ShellToolTemplateSchema,
} from './shell-tool.template';

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
      getNodeInstance: vi.fn(),
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
      expect(() => ShellToolTemplateSchema.parse({})).not.toThrow();
    });

    it('should ignore legacy/unknown fields', () => {
      const dataWithExtra = {
        someOldField: true,
        anotherExtra: 'value',
      };

      const parsed = ShellToolTemplateSchema.parse(dataWithExtra);
      expect(parsed).toEqual({});
      expect(parsed).not.toHaveProperty('someOldField');
    });
  });

  describe('create', () => {
    const mockRuntimeNodeId = 'runtime-1';
    const mockGraphId = 'graph-1';
    const mockMetadata = {
      graphId: mockGraphId,
      nodeId: 'tool-1',
      version: '1',
    };

    let mockRuntime: BaseRuntime;

    beforeEach(() => {
      mockRuntime = {
        exec: vi
          .fn()
          .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
      } as unknown as BaseRuntime;

      vi.mocked(mockGraphRegistry.filterNodesByType).mockImplementation(
        (_gid, _nodes, kind) =>
          kind === NodeKind.Runtime ? [mockRuntimeNodeId] : [],
      );

      vi.mocked(mockGraphRegistry.getNodeInstance).mockImplementation(
        (gid, nid) => (nid === mockRuntimeNodeId ? mockRuntime : null),
      );
    });

    it('should create shell tool with valid runtime node', async () => {
      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      vi.mocked(mockShellTool.build).mockReturnValue(mockTool);

      const outputNodeIds = new Set([mockRuntimeNodeId]);
      const config = {};
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockShellTool.build).toHaveBeenCalled();
      expect(instance).toEqual([mockTool]);
    });

    it('should throw NotFoundException when runtime node not found', async () => {
      vi.mocked(mockGraphRegistry.filterNodesByType).mockReturnValue([]);

      const config = {};
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

    it('should throw NotFoundException with correct error message', async () => {
      vi.mocked(mockGraphRegistry.filterNodesByType).mockReturnValue([]);

      const config = {};
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);

      await expect(handle.configure(init, instance)).rejects.toThrow(
        /Runtime node not found in output nodes/,
      );
    });

    it('should handle shell tool build errors', async () => {
      vi.mocked(mockShellTool.build).mockImplementation(() => {
        throw new Error('Build failed');
      });

      const outputNodeIds = new Set([mockRuntimeNodeId]);
      const config = {};
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);

      await expect(handle.configure(init, instance)).rejects.toThrow(
        'Build failed',
      );
    });

    it('should work with different runtime node IDs', async () => {
      const customRuntimeId = 'custom-rt-999';
      const mockTool = { name: 'shell' } as DynamicStructuredTool;
      vi.mocked(mockShellTool.build).mockReturnValue(mockTool);

      vi.mocked(mockGraphRegistry.filterNodesByType).mockImplementation(
        (_gid, _nodes, kind) =>
          kind === NodeKind.Runtime ? [customRuntimeId] : [],
      );
      vi.mocked(mockGraphRegistry.getNodeInstance).mockImplementation(
        (_gid, nid) => (nid === customRuntimeId ? mockRuntime : null),
      );

      const outputNodeIds = new Set([customRuntimeId]);
      const config = {};
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockShellTool.build).toHaveBeenCalled();
      expect(instance).toEqual([mockTool]);
    });

    it('should handle null/undefined runtime node gracefully', async () => {
      vi.mocked(mockGraphRegistry.getNodeInstance).mockReturnValue(null);

      const outputNodeIds = new Set([mockRuntimeNodeId]);
      const config = {};
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

    describe('resource integration', () => {
      const mockResourceId = 'res-1';
      const mockResourceOutput: IShellResourceOutput = {
        kind: ResourceKind.Shell,
        information: 'Resource info',
        data: {
          env: { KEY: 'VALUE' },
          initScript: 'echo init',
          initScriptTimeout: 5000,
        },
      } as any;

      beforeEach(() => {
        vi.mocked(mockGraphRegistry.filterNodesByType).mockImplementation(
          (_gid, nodes, kind) => {
            if (kind === NodeKind.Runtime) return [mockRuntimeNodeId];
            if (kind === NodeKind.Resource)
              return Array.from(nodes).filter((id) => id === mockResourceId);
            return [];
          },
        );

        vi.mocked(mockGraphRegistry.getNode).mockImplementation((_gid, id) => {
          if (id === mockResourceId) {
            return buildMockNode({
              id: mockResourceId,
              type: NodeKind.Resource,
              template: 'github-resource',
              instance: mockResourceOutput,
            });
          }
          return undefined;
        });
      });

      it('should create shell tool with resources', async () => {
        const outputNodeIds = new Set([mockRuntimeNodeId, mockResourceId]);
        const config = {};
        const handle = await template.create();
        const init: GraphNode<typeof config> = {
          config,
          inputNodeIds: new Set(),
          outputNodeIds,
          metadata: mockMetadata,
        };
        const instance = await handle.provide(init);
        await handle.configure(init, instance);

        expect(mockShellTool.build).toHaveBeenCalledWith(
          expect.objectContaining({
            env: { KEY: 'VALUE' },
            resourcesInformation: expect.stringContaining('Resource info'),
          }),
        );
      });

      it('should ignore non-resource nodes in resourceNodeIds', async () => {
        const otherNodeId = 'other-node';
        vi.mocked(mockGraphRegistry.getNode).mockImplementation((_gid, id) => {
          if (id === mockResourceId) {
            return buildMockNode({
              id: mockResourceId,
              type: NodeKind.Resource,
              template: 'github-resource',
              instance: mockResourceOutput,
            });
          }
          if (id === otherNodeId) {
            return buildMockNode({
              id: otherNodeId,
              type: NodeKind.SimpleAgent,
              template: 'simple-agent',
              instance: {},
            });
          }
          return undefined;
        });

        const outputNodeIds = new Set([
          mockRuntimeNodeId,
          mockResourceId,
          otherNodeId,
        ]);
        const config = {};
        const handle = await template.create();
        const init: GraphNode<typeof config> = {
          config,
          inputNodeIds: new Set(),
          outputNodeIds,
          metadata: mockMetadata,
        };
        const instance = await handle.provide(init);
        await handle.configure(init, instance);

        expect(mockGraphRegistry.filterNodesByType).toHaveBeenCalledWith(
          mockGraphId,
          outputNodeIds,
          NodeKind.Resource,
        );
      });

      it('should handle missing resource nodes gracefully', async () => {
        vi.mocked(mockGraphRegistry.getNode).mockReturnValue(undefined);

        const outputNodeIds = new Set([mockRuntimeNodeId, mockResourceId]);
        const config = {};
        const handle = await template.create();
        const init: GraphNode<typeof config> = {
          config,
          inputNodeIds: new Set(),
          outputNodeIds,
          metadata: mockMetadata,
        };
        const instance = await handle.provide(init);
        await handle.configure(init, instance);

        expect(mockShellTool.build).toHaveBeenCalledWith(
          expect.objectContaining({
            env: {},
            resourcesInformation: '',
          }),
        );
      });

      it('should execute init scripts from resources', async () => {
        const outputNodeIds = new Set([mockRuntimeNodeId, mockResourceId]);
        const config = {};
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
            timeoutMs: 5000,
            env: { KEY: 'VALUE' },
          }),
        );
      });

      it('should handle multiple resources with different init scripts', async () => {
        const res2Id = 'res-2';
        const res2Output = {
          kind: ResourceKind.Shell,
          information: 'Res 2 info',
          data: {
            env: { KEY2: 'VALUE2' },
            initScript: 'echo init2',
          },
        } as any;

        vi.mocked(mockGraphRegistry.filterNodesByType).mockImplementation(
          (_gid, nodes, kind) => {
            if (kind === NodeKind.Runtime) return [mockRuntimeNodeId];
            if (kind === NodeKind.Resource)
              return Array.from(nodes).filter(
                (id) => id === mockResourceId || id === res2Id,
              );
            return [];
          },
        );

        vi.mocked(mockGraphRegistry.getNode).mockImplementation((_gid, id) => {
          if (id === mockResourceId) {
            return buildMockNode({
              id: mockResourceId,
              type: NodeKind.Resource,
              template: 'github-resource',
              instance: mockResourceOutput,
            });
          }
          if (id === res2Id) {
            return buildMockNode({
              id: res2Id,
              type: NodeKind.Resource,
              template: 'github-resource',
              instance: res2Output,
            });
          }
          return undefined;
        });

        const outputNodeIds = new Set([
          mockRuntimeNodeId,
          mockResourceId,
          res2Id,
        ]);
        const config = {};
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
          expect.objectContaining({ cmd: 'echo init' }),
        );
        expect(mockRuntime.exec).toHaveBeenCalledWith(
          expect.objectContaining({ cmd: 'echo init2' }),
        );
        expect(mockShellTool.build).toHaveBeenCalledWith(
          expect.objectContaining({
            env: { KEY: 'VALUE', KEY2: 'VALUE2' },
          }),
        );
      });
    });
  });
});
