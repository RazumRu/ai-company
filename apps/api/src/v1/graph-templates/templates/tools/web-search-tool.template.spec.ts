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
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(template.name).toBe('web-search-tool');
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

    it('should reject additional properties with strict schema', () => {
      const configWithExtra = {
        someProperty: 'value',
        anotherProperty: 123,
      };

      // With strict schema, additional properties should be rejected
      expect(() =>
        WebSearchToolTemplateSchema.parse(configWithExtra),
      ).toThrow();
    });
  });

  describe('create', () => {
    it('should create web search tool with apiKey configuration', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockReturnValue(mockTool);

      const config = { apiKey: 'test-api-key' };
      const compiledNodes = new Map<string, CompiledGraphNode>();

      const result = await template.create(config, new Map(), compiledNodes, {
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
        apiKey: 'test-api-key',
      };

      const result = await template.create(config, new Map(), new Map(), {
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

      const config = { apiKey: 'test-api-key' };

      await expect(
        template.create(config, new Map(), new Map(), {
          graphId: 'test-graph',
          nodeId: 'test-node',
          version: '1.0.0',
        }),
      ).rejects.toThrow('Failed to build web search tool');
    });

    it('should not use compiled nodes parameter', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockReturnValue(mockTool);

      const config = { apiKey: 'test-api-key' };
      const compiledNodes = new Map([
        [
          'some-node',
          {
            id: 'some-node',
            type: NodeKind.Runtime,
            template: 'some-template',
            config: {},
            instance: {},
          },
        ],
      ]);

      const result = await template.create(config, new Map(), compiledNodes, {
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
      };

      await template.create(config, new Map(), new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });

      expect(mockWebSearchTool.build).toHaveBeenCalledWith(config);
    });

    it('should handle async build method', async () => {
      const mockTool = { name: 'web-search' } as DynamicStructuredTool;
      mockWebSearchTool.build = vi.fn().mockResolvedValue(mockTool);

      const config = { apiKey: 'test-api-key' };

      const result = await template.create(config, new Map(), new Map(), {
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

      const config1 = { apiKey: 'test-key-1' };
      const config2 = { apiKey: 'test-key-2' };

      const result1 = await template.create(config1, new Map(), new Map(), {
        graphId: 'test-graph',
        nodeId: 'test-node',
        version: '1.0.0',
      });
      const result2 = await template.create(config2, new Map(), new Map(), {
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
