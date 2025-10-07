import { DynamicStructuredTool } from '@langchain/core/tools';
import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSearchTool } from '../../../agent-tools/tools/web-search.tool';
import { CompiledGraphNode, NodeKind } from '../../../graphs/graphs.types';
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
    } as any;

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
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('web-search-tool');
    });

    it('should have correct description', () => {
      expect(template.description).toBe('Web search tool');
    });

    it('should have correct kind', () => {
      expect(template.kind).toBe(NodeKind.Tool);
    });

    it('should have correct schema', () => {
      expect(template.schema).toBe(WebSearchToolTemplateSchema);
    });
  });

  describe('schema validation', () => {
    it('should validate empty configuration', () => {
      const validConfig = {};

      expect(() =>
        WebSearchToolTemplateSchema.parse(validConfig),
      ).not.toThrow();
    });

    it('should accept any additional properties', () => {
      const configWithExtra = {
        someProperty: 'value',
        anotherProperty: 123,
      };

      // Since it's an empty z.object(), it should accept additional properties
      expect(() =>
        WebSearchToolTemplateSchema.parse(configWithExtra),
      ).not.toThrow();
    });
  });

  describe('create', () => {
    it('should create web search tool with empty configuration', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};
      const compiledNodes = new Map<string, CompiledGraphNode>();

      const result = await template.create(config, compiledNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockWebSearchTool.build).toHaveBeenCalledWith(config);
      expect(result).toBe(mockTool);
    });

    it('should create web search tool with configuration properties', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {
        customProperty: 'value',
        timeout: 5000,
      } as any;

      const result = await template.create(config, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockWebSearchTool.build).toHaveBeenCalledWith(config);
      expect(result).toBe(mockTool);
    });

    it('should handle web search tool build errors', async () => {
      const mockError = new Error('Failed to build web search tool');
      mockWebSearchTool.build = vi.fn().mockImplementation(() => {
        throw mockError;
      });

      const config = {};

      await expect(
        template.create(config, new Map(), {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow('Failed to build web search tool');
    });

    it('should not use compiled nodes parameter', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {};
      const compiledNodes = new Map([
        ['some-node', { id: 'some-node', type: 'runtime', instance: {} }],
      ]);

      const result = await template.create(config, compiledNodes, {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      // Should still work regardless of compiled nodes content
      expect(mockWebSearchTool.build).toHaveBeenCalledWith(config);
      expect(result).toBe(mockTool);
    });

    it('should pass through all configuration properties', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockReturnValue(mockTool);

      const config = {
        apiKey: 'test-key',
        maxResults: 10,
        timeout: 30000,
        enableCache: true,
        customHeaders: { 'User-Agent': 'test-agent' },
      } as any;

      await template.create(config, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockWebSearchTool.build).toHaveBeenCalledWith(config);
    });

    it('should handle async build method', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockResolvedValue(mockTool);

      const config = {};

      const result = await template.create(config, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(result).toBe(mockTool);
    });

    it('should maintain tool instance identity', async () => {
      const mockTool1 = { name: 'web-search-1' } as DynamicStructuredTool;
      const mockTool2 = { name: 'web-search-2' } as DynamicStructuredTool;

      mockWebSearchTool.build = vi
        .fn()
        .mockReturnValueOnce(mockTool1)
        .mockReturnValueOnce(mockTool2);

      const config1 = { instance: 1 } as any;
      const config2 = { instance: 2 } as any;

      const result1 = await template.create(config1, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });
      const result2 = await template.create(config2, new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(result1).toBe(mockTool1);
      expect(result2).toBe(mockTool2);
      expect(result1).not.toBe(result2);
    });
  });
});
