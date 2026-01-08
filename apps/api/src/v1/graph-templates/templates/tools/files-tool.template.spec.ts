import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FilesToolGroup } from '../../../agent-tools/tools/common/files/files-tool-group';
import { GraphNode, NodeKind } from '../../../graphs/graphs.types';
import { GraphRegistry } from '../../../graphs/services/graph-registry';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import {
  FilesToolTemplate,
  FilesToolTemplateSchema,
} from './files-tool.template';

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
      getNodeInstance: vi.fn(),
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
    it('should accept empty config (models come from env)', () => {
      expect(() => FilesToolTemplateSchema.parse({})).not.toThrow();
    });

    it('should ignore legacy/unknown fields', () => {
      const dataWithExtra = {
        fastModel: 'gpt-5-mini',
        smartModel: 'gpt-5.1',
        oldProperty: 'value',
        extraField: 123,
      };

      const parsed = FilesToolTemplateSchema.parse(dataWithExtra);
      expect(parsed).toEqual({
        includeEditActions: true,
      });
      expect(parsed).not.toHaveProperty('oldProperty');
    });
  });

  describe('create', () => {
    const mockRuntimeId = 'runtime-1';
    const mockGraphId = 'graph-1';
    const mockMetadata = {
      graphId: mockGraphId,
      nodeId: 'tool-1',
      version: '1',
    };

    let mockRuntime: BaseRuntime;

    beforeEach(() => {
      mockRuntime = {
        exec: vi.fn(),
      } as unknown as BaseRuntime;

      vi.mocked(mockGraphRegistry.filterNodesByType).mockImplementation(
        (_gid, _nodes, kind) =>
          kind === NodeKind.Runtime ? [mockRuntimeId] : [],
      );

      vi.mocked(mockGraphRegistry.getNodeInstance).mockImplementation(
        (_gid, nid) => (nid === mockRuntimeId ? mockRuntime : undefined),
      );
    });

    it('should create files tools with valid runtime node', async () => {
      const mockTools = [{ name: 'read_file' }] as DynamicStructuredTool[];
      vi.mocked(mockFilesToolGroup.buildTools).mockReturnValue({
        tools: mockTools,
        instructions: undefined,
      });

      const outputNodeIds = new Set([mockRuntimeId]);
      const config = {
        includeEditActions: true,
      };
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockFilesToolGroup.buildTools).toHaveBeenCalled();
      expect(instance.tools).toEqual(mockTools);
    });

    it('should throw NotFoundException when runtime node is not found in output nodes', async () => {
      vi.mocked(mockGraphRegistry.filterNodesByType).mockReturnValue([]);

      const config = {
        includeEditActions: false,
      };
      const handle = await template.create();
      const outputNodeIds = new Set<string>();
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

    it('should throw NotFoundException when runtime node does not exist in registry', async () => {
      vi.mocked(mockGraphRegistry.getNodeInstance).mockReturnValue(undefined);

      const outputNodeIds = new Set([mockRuntimeId]);
      const config = {
        includeEditActions: false,
      };
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

    it('should use runtime from config', async () => {
      const mockTools = [{ name: 'read_file' }] as DynamicStructuredTool[];
      vi.mocked(mockFilesToolGroup.buildTools).mockReturnValue({
        tools: mockTools,
        instructions: undefined,
      });

      const outputNodeIds = new Set([mockRuntimeId]);
      const config = {
        includeEditActions: true,
      };
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      const buildConfig = vi.mocked(mockFilesToolGroup.buildTools).mock
        .calls[0]![0] as any;

      expect(buildConfig.runtime).toBe(mockRuntime);
    });

    it('should throw NotFoundException when runtime node cannot be found in configure', async () => {
      const mockTools = [{ name: 'read_file' }] as DynamicStructuredTool[];
      vi.mocked(mockFilesToolGroup.buildTools).mockReturnValue({
        tools: mockTools,
        instructions: undefined,
      });

      const outputNodeIds = new Set([mockRuntimeId]);
      const config = {
        includeEditActions: true,
      };
      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds,
        metadata: mockMetadata,
      };
      const instance = await handle.provide(init);

      // Simulate runtime disappearing from registry
      vi.mocked(mockGraphRegistry.getNodeInstance).mockReturnValue(undefined);

      await expect(handle.configure(init, instance)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
