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

    tool = await module.resolve<WebSearchTool>(WebSearchTool);
  });

  describe('schema', () => {
    it('should validate required searchQuery field', () => {
      const validData = {
        searchQuery: 'test search',
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should reject empty searchQuery', () => {
      const invalidData = {
        searchQuery: '',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should reject missing searchQuery', () => {
      const invalidData = {};
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should validate searchDepth enum', () => {
      const validBasic = {
        searchQuery: 'test',
        searchDepth: 'basic',
      };
      const validAdvanced = {
        searchQuery: 'test',
        searchDepth: 'advanced',
      };

      expect(() => tool.validate(validBasic)).not.toThrow();
      expect(() => tool.validate(validAdvanced)).not.toThrow();
    });

    it('should reject invalid searchDepth', () => {
      const invalidData = {
        searchQuery: 'test',
        searchDepth: 'invalid',
      };
      expect(() => tool.validate(invalidData)).toThrow();
    });

    it('should default searchDepth to basic', () => {
      const data = {
        searchQuery: 'test',
      };
      const parsed = tool.validate(data);
      expect(parsed.searchDepth).toBe('basic');
    });

    it('should validate optional arrays', () => {
      const validData = {
        searchQuery: 'test',
        onlyFromDomains: ['example.com', 'test.org'],
        skipDomains: ['spam.com'],
      };
      expect(() => tool.validate(validData)).not.toThrow();
    });

    it('should validate maxResults range', () => {
      const validMin = {
        searchQuery: 'test',
        maxResults: 1,
      };
      const validMax = {
        searchQuery: 'test',
        maxResults: 20,
      };
      const validMid = {
        searchQuery: 'test',
        maxResults: 10,
      };

      expect(() => tool.validate(validMin)).not.toThrow();
      expect(() => tool.validate(validMax)).not.toThrow();
      expect(() => tool.validate(validMid)).not.toThrow();
    });

    it('should reject maxResults out of range', () => {
      const tooSmall = {
        searchQuery: 'test',
        maxResults: 0,
      };
      const tooLarge = {
        searchQuery: 'test',
        maxResults: 21,
      };

      expect(() => tool.validate(tooSmall)).toThrow();
      expect(() => tool.validate(tooLarge)).toThrow();
    });
  });

  describe('build', () => {
    it('should create a DynamicStructuredTool', () => {
      const builtTool = tool.build({ apiKey: 'test-api-key' });

      expect(builtTool).toBeDefined();
      expect(typeof builtTool.invoke).toBe('function');
      expect(builtTool.name).toBe('web_search');
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
      const { output: result, messageMetadata } = await builtTool.invoke({
        searchQuery: 'test search',
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
      expect(messageMetadata?.__title).toBe('Search in internet: test search');
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
      const { output: result } = await builtTool.invoke({
        searchQuery: 'advanced search',
        searchDepth: 'advanced',
        onlyFromDomains: ['example.com'],
        skipDomains: ['spam.com'],
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
      const { output: result } = await builtTool.invoke({
        searchQuery: 'no results query',
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
      const { output: result } = await builtTool.invoke({
        searchQuery: 'undefined results query',
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
          searchQuery: 'error query',
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
      const { output: result } = await builtTool.invoke({
        searchQuery: 'test search',
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
