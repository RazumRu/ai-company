import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSearchTool } from './web-search.tool';

// Mock tavily module
vi.mock('@tavily/core', () => ({
  tavily: vi.fn(() => ({
    search: vi.fn(),
  })),
}));

type TavilyClient = {
  search: ReturnType<typeof vi.fn>;
};

describe('WebSearchTool', () => {
  let tool: WebSearchTool;
  let mockTavilyClient: TavilyClient;

  beforeEach(async () => {
    const { tavily } = await import('@tavily/core');
    mockTavilyClient = {
      search: vi.fn(),
    };
    vi.mocked(tavily).mockReturnValue(
      mockTavilyClient as unknown as ReturnType<typeof tavily>,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [WebSearchTool],
    }).compile();

    tool = module.get<WebSearchTool>(WebSearchTool);
  });

  describe('properties', () => {
    it('should have correct name', () => {
      expect(tool.name).toBe('web-search');
    });

    it('should have correct description', () => {
      expect(tool.description).toBe(
        'Search the web for up-to-date information and return top results. For deeper results set searchDepth="advanced".',
      );
    });

    it('should not be marked as system tool', () => {
      expect(tool.system).toBe(false);
    });
  });

  describe('schema', () => {
    it('should validate required purpose and query fields', () => {
      const validData = {
        purpose: 'Searching for information about TypeScript',
        query: 'test search',
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should reject missing purpose field', () => {
      const invalidData = { query: 'test search' };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject empty query', () => {
      const invalidData = {
        purpose: 'Searching for information',
        query: '',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject missing query', () => {
      const invalidData = { purpose: 'Searching for information' };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should reject empty purpose', () => {
      const invalidData = { purpose: '', query: 'test search' };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should validate searchDepth enum', () => {
      const validBasic = {
        purpose: 'Searching for information',
        query: 'test',
        searchDepth: 'basic',
      };
      const validAdvanced = {
        purpose: 'Searching for information',
        query: 'test',
        searchDepth: 'advanced',
      };

      expect(() => tool.schema.parse(validBasic)).not.toThrow();
      expect(() => tool.schema.parse(validAdvanced)).not.toThrow();
    });

    it('should reject invalid searchDepth', () => {
      const invalidData = {
        purpose: 'Searching for information',
        query: 'test',
        searchDepth: 'invalid',
      };
      expect(() => tool.schema.parse(invalidData)).toThrow();
    });

    it('should default searchDepth to basic', () => {
      const data = {
        purpose: 'Searching for information',
        query: 'test',
      };
      const parsed = tool.schema.parse(data);
      expect(parsed.searchDepth).toBe('basic');
    });

    it('should validate optional arrays', () => {
      const validData = {
        purpose: 'Searching for information',
        query: 'test',
        includeDomains: ['example.com', 'test.org'],
        excludeDomains: ['spam.com'],
      };
      expect(() => tool.schema.parse(validData)).not.toThrow();
    });

    it('should validate maxResults range', () => {
      const validMin = {
        purpose: 'Searching for information',
        query: 'test',
        maxResults: 1,
      };
      const validMax = {
        purpose: 'Searching for information',
        query: 'test',
        maxResults: 20,
      };
      const validMid = {
        purpose: 'Searching for information',
        query: 'test',
        maxResults: 10,
      };

      expect(() => tool.schema.parse(validMin)).not.toThrow();
      expect(() => tool.schema.parse(validMax)).not.toThrow();
      expect(() => tool.schema.parse(validMid)).not.toThrow();
    });

    it('should reject maxResults out of range', () => {
      const tooSmall = {
        purpose: 'Searching for information',
        query: 'test',
        maxResults: 0,
      };
      const tooLarge = {
        purpose: 'Searching for information',
        query: 'test',
        maxResults: 21,
      };

      expect(() => tool.schema.parse(tooSmall)).toThrow();
      expect(() => tool.schema.parse(tooLarge)).toThrow();
    });
  });

  describe('build', () => {
    it('should create a DynamicStructuredTool', () => {
      const builtTool = tool.build({ apiKey: 'test-api-key' });

      expect(builtTool).toBeDefined();
      expect(typeof builtTool.invoke).toBe('function');
      expect(builtTool.name).toBe('web-search');
    });

    it('should perform basic search', async () => {
      const mockSearchResult = {
        answer: 'Test answer',
        results: [
          {
            title: 'Test Title',
            url: 'https://example.com',
            content: 'Test content',
          },
        ],
      };
      mockTavilyClient.search.mockResolvedValue(mockSearchResult);

      const builtTool = tool.build({ apiKey: 'test-api-key' });
      const result = await builtTool.invoke({
        purpose: 'Searching for test information',
        query: 'test search',
      });

      expect(mockTavilyClient.search).toHaveBeenCalledWith('test search', {
        searchDepth: 'basic',
      });

      expect(result).toEqual({
        answer: 'Test answer',
        results: [
          {
            title: 'Test Title',
            url: 'https://example.com',
            content: 'Test content',
          },
        ],
      });
    });

    it('should perform advanced search with options', async () => {
      const mockSearchResult = {
        answer: 'Advanced answer',
        results: [
          {
            title: 'Advanced Title',
            url: 'https://advanced.com',
            content: 'Advanced content',
          },
        ],
      };
      mockTavilyClient.search.mockResolvedValue(mockSearchResult);

      const builtTool = tool.build({ apiKey: 'test-api-key' });
      const result = await builtTool.invoke({
        purpose: 'Performing advanced search',
        query: 'advanced search',
        searchDepth: 'advanced',
        includeDomains: ['example.com'],
        excludeDomains: ['spam.com'],
        maxResults: 5,
      });

      expect(mockTavilyClient.search).toHaveBeenCalledWith('advanced search', {
        searchDepth: 'advanced',
        includeDomains: ['example.com'],
        excludeDomains: ['spam.com'],
        maxResults: 5,
      });

      expect(result).toEqual({
        answer: 'Advanced answer',
        results: [
          {
            title: 'Advanced Title',
            url: 'https://advanced.com',
            content: 'Advanced content',
          },
        ],
      });
    });

    it('should handle empty results', async () => {
      const mockSearchResult = {
        answer: 'No results found',
        results: null,
      };
      mockTavilyClient.search.mockResolvedValue(mockSearchResult);

      const builtTool = tool.build({ apiKey: 'test-api-key' });
      const result = await builtTool.invoke({
        purpose: 'Testing empty results',
        query: 'no results query',
      });

      expect(result).toEqual({
        answer: 'No results found',
        results: [],
      });
    });

    it('should handle undefined results', async () => {
      const mockSearchResult = {
        answer: 'Undefined results',
        results: undefined,
      };
      mockTavilyClient.search.mockResolvedValue(mockSearchResult);

      const builtTool = tool.build({ apiKey: 'test-api-key' });
      const result = await builtTool.invoke({
        purpose: 'Testing undefined results',
        query: 'undefined results query',
      });

      expect(result).toEqual({
        answer: 'Undefined results',
        results: [],
      });
    });

    it('should handle search errors', async () => {
      const mockError = new Error('Search API error');
      mockTavilyClient.search.mockRejectedValue(mockError);

      const builtTool = tool.build({ apiKey: 'test-api-key' });

      await expect(
        builtTool.invoke({
          purpose: 'Testing error handling',
          query: 'error query',
        }),
      ).rejects.toThrow('Search API error');
    });

    it('should filter result fields correctly', async () => {
      const mockSearchResult = {
        answer: 'Test answer',
        results: [
          {
            title: 'Test Title',
            url: 'https://example.com',
            content: 'Test content',
            score: 0.95,
            published_date: '2023-01-01',
            // These extra fields should be filtered out
          },
        ],
      };
      mockTavilyClient.search.mockResolvedValue(mockSearchResult);

      const builtTool = tool.build({ apiKey: 'test-api-key' });
      const result = await builtTool.invoke({
        purpose: 'Testing result filtering',
        query: 'test search',
      });

      expect(result.results[0]).toEqual({
        title: 'Test Title',
        url: 'https://example.com',
        content: 'Test content',
      });
      expect(result.results[0]).not.toHaveProperty('score');
      expect(result.results[0]).not.toHaveProperty('published_date');
    });
  });
});
