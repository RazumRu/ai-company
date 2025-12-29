import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSearchTool } from '../../../agent-tools/tools/common/web-search.tool';
import type { GraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import {
  WebSearchToolTemplate,
  WebSearchToolTemplateSchema,
} from './web-search-tool.template';

describe('WebSearchToolTemplate', () => {
  let template: WebSearchToolTemplate;
  let mockWebSearchTool: WebSearchTool;

  beforeEach(async () => {
    mockWebSearchTool = {
      build: vi.fn(),
    } as unknown as WebSearchTool;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebSearchToolTemplate,
        {
          provide: WebSearchTool,
          useValue: mockWebSearchTool,
        },
      ],
    }).compile();

    template = module.get<WebSearchToolTemplate>(WebSearchToolTemplate);
    vi.spyOn(template as any, 'createNewInstance').mockResolvedValue(
      mockWebSearchTool,
    );
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('Web search');
    });

    it('should have correct description', () => {
      expect(template.description).toBe('Search the web for information');
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.Tool);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(WebSearchToolTemplateSchema);
    });
  });

  describe('schema validation', () => {
    it('should validate configuration with apiKey', () => {
      const validConfig = { apiKey: 'test-api-key' };

      expect(() =>
        WebSearchToolTemplateSchema.parse(validConfig),
      ).not.toThrow();
    });

    it('should ignore additional properties', () => {
      const configWithExtra = {
        apiKey: 'test-api-key',
        someProperty: 'value',
        anotherProperty: 123,
      };

      const parsed = WebSearchToolTemplateSchema.parse(configWithExtra);
      expect(parsed).toEqual({ apiKey: 'test-api-key' });
      expect(parsed).not.toHaveProperty('someProperty');
      expect(parsed).not.toHaveProperty('anotherProperty');
    });
  });

  describe('create', () => {
    it('should create web search tool with apiKey configuration', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockReturnValue(mockTool);

      const config = { apiKey: 'test-api-key' };
      const metadata = {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockWebSearchTool.build).toHaveBeenCalledWith(config);
      expect(instance).toEqual([mockTool]);
    });

    it('should create web search tool with configuration properties', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {
        apiKey: 'another-key',
      };
      const metadata = {
        graphId: 'test-graph-2',
        nodeId: 'test-node-2',
        version: '1.0.1',
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockWebSearchTool.build).toHaveBeenCalledWith(config);
      expect(instance).toEqual([mockTool]);
    });

    it('should handle web search tool build errors', async () => {
      mockWebSearchTool.build = vi.fn().mockImplementation(() => {
        throw new Error('Build failed');
      });

      const config = { apiKey: 'test-key' };
      const metadata = {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(init);

      await expect(handle.configure(init, instance)).rejects.toThrow(
        'Build failed',
      );
    });

    it('should not use compiled nodes parameter', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockReturnValue(mockTool);

      const config = { apiKey: 'test-key' };
      const metadata = {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockWebSearchTool.build).toHaveBeenCalled();
      expect(instance).toEqual([mockTool]);
    });

    it('should pass through all configuration properties', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {
        apiKey: 'custom-key',
      };
      const metadata = {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(mockWebSearchTool.build).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'custom-key',
        }),
      );
    });

    it('should handle async build method', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      // build is synchronous in current implementation, but test for async compatibility
      mockWebSearchTool.build = vi.fn().mockResolvedValue(mockTool);

      const config = { apiKey: 'test-key' };
      const metadata = {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      expect(instance).toEqual([mockTool]);
    });

    it('should maintain tool instance identity', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockReturnValue(mockTool);

      const config = { apiKey: 'test-key' };
      const metadata = {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      };

      const handle = await template.create();
      const init: GraphNode<typeof config> = {
        config,
        inputNodeIds: new Set(),
        outputNodeIds: new Set(),
        metadata,
      };
      const instance = await handle.provide(init);
      await handle.configure(init, instance);

      const tools1 = instance;
      await handle.configure(init, instance);
      const tools2 = instance;

      expect(tools1).toBe(tools2);
      expect(tools1[0]).toBe(mockTool);
    });
  });
});
