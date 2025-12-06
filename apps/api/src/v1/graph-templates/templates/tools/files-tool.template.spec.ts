import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesToolGroup } from '../../../agent-tools/tools/common/files/files-tool-group';
import {
  CompiledGraphNode,
  GraphNodeStatus,
  NodeKind,
} from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import {
  FilesToolTemplate,
  FilesToolTemplateSchema,
} from './files-tool.template';

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

describe('FilesToolTemplate', () => {
  let template: FilesToolTemplate;
  let mockFilesToolGroup: FilesToolGroup;
  let mockGraphRegistry: GraphRegistry;

  beforeEach(async () => {
    mockFilesToolGroup = {
      buildTools: vi.fn(),
    } as unknown as FilesToolGroup;

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
        FilesToolTemplate,
        {
          provide: FilesToolGroup,
          useValue: mockFilesToolGroup,
        },
        {
          provide: GraphRegistry,
          useValue: mockGraphRegistry,
        },
      ],
    }).compile();

    template = module.get<FilesToolTemplate>(FilesToolTemplate);
  });

  describe('properties', () => {
    it('should have correct id', () => {
      expect(template.id).toBe('files-tool');
    });

    it('should have correct name', () => {
      expect(template.name).toBe('Files Tools');
    });

    it('should have correct description', () => {
      expect(template.description).toBe(
        'Tools for working with files in repositories',
      );
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.Tool);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(FilesToolTemplateSchema);
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
          type: 'kind',
          value: NodeKind.Runtime,
          required: true,
          multiple: false,
        },
      ]);
    });
  });

  describe('schema validation', () => {
    it('should accept empty config', () => {
      const config = {};

      const parsed = FilesToolTemplateSchema.parse(config);
      expect(parsed).toEqual({});
    });

    it('should ignore legacy/unknown fields', () => {
      const config = { includeRepo: true, extra: 'value' };

      const parsed = FilesToolTemplateSchema.parse(config);
      expect(parsed).toEqual({});
      expect(parsed).not.toHaveProperty('includeRepo');
      expect(parsed).not.toHaveProperty('extra');
    });
  });

  describe('create', () => {
    it('should create files tools with valid runtime node', async () => {
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

      const mockTools = [{ name: 'repo_list_files' } as DynamicStructuredTool];

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
      mockFilesToolGroup.buildTools = vi.fn().mockReturnValue(mockTools);

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
      expect(mockFilesToolGroup.buildTools).toHaveBeenCalled();
      expect(result).toEqual(mockTools);
    });

    it('should throw NotFoundException when runtime node is not found in output nodes', async () => {
      mockGraphRegistry.filterNodesByType = vi.fn().mockReturnValue([]);

      const config = {};
      const outputNodeIds = new Set(['other-node']);

      await expect(
        template.create(config, new Set(), outputNodeIds, {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockGraphRegistry.filterNodesByType).toHaveBeenCalledWith(
        'test-graph',
        outputNodeIds,
        NodeKind.Runtime,
      );
    });

    it('should throw NotFoundException when runtime node does not exist in registry', async () => {
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
      expect(mockGraphRegistry.getNode).toHaveBeenCalledWith(
        'test-graph',
        'runtime-1',
      );
    });

    it('should use runtime getter function that fetches fresh instance on each invocation', async () => {
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

      const mockTools = [{ name: 'repo_list_files' } as DynamicStructuredTool];

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-1']);
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          return undefined;
        });
      mockFilesToolGroup.buildTools = vi.fn().mockReturnValue(mockTools);

      const config = {};
      const outputNodeIds = new Set(['runtime-1']);

      await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockFilesToolGroup.buildTools).toHaveBeenCalled();
      const buildToolsCall = vi.mocked(mockFilesToolGroup.buildTools).mock
        .calls[0]![0];
      expect(buildToolsCall.runtime).toBeInstanceOf(Function);

      // Verify the runtime getter function works
      const runtimeGetter = buildToolsCall.runtime as () => BaseRuntime;
      const fetchedRuntime = runtimeGetter();
      expect(fetchedRuntime).toBe(mockRuntime);
    });

    it('should throw NotFoundException when runtime getter cannot find runtime node', async () => {
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

      const mockTools = [{ name: 'repo_list_files' } as DynamicStructuredTool];

      mockGraphRegistry.filterNodesByType = vi
        .fn()
        .mockReturnValue(['runtime-1']);
      mockGraphRegistry.getNode = vi
        .fn()
        .mockImplementation((_graphId, nodeId) => {
          if (nodeId === 'runtime-1') return mockRuntimeNode;
          return undefined;
        });
      mockFilesToolGroup.buildTools = vi.fn().mockReturnValue(mockTools);

      const config = {};
      const outputNodeIds = new Set(['runtime-1']);

      await template.create(config, new Set(), outputNodeIds, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      // Now simulate runtime node being removed
      mockGraphRegistry.getNode = vi.fn().mockReturnValue(undefined);

      const buildToolsCall = vi.mocked(mockFilesToolGroup.buildTools).mock
        .calls[0]![0];
      const runtimeGetter = buildToolsCall.runtime as () => BaseRuntime;

      expect(() => runtimeGetter()).toThrow(NotFoundException);
    });
  });
});
