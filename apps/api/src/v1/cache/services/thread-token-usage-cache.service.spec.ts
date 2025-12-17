import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type { TokenUsage } from '../../litellm/litellm.types';
import { CacheService } from './cache.service';
import { ThreadTokenUsageCacheService } from './thread-token-usage-cache.service';

describe('ThreadTokenUsageCacheService', () => {
  let service: ThreadTokenUsageCacheService;
  let mockCacheService: ReturnType<typeof mock<CacheService>>;
  let mockLogger: ReturnType<typeof mock<DefaultLogger>>;

  beforeEach(() => {
    mockCacheService = mock<CacheService>();
    mockLogger = mock<DefaultLogger>();

    service = new ThreadTokenUsageCacheService(mockCacheService, mockLogger);
  });

  describe('setThreadTokenUsage', () => {
    it('should store per-node token usage in Redis', async () => {
      const threadId = 'thread-123';
      const byNode: Record<string, TokenUsage> = {
        node1: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
          totalPrice: 0.001,
        },
        node2: {
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
          totalPrice: 0.002,
        },
      };

      await service.setThreadTokenUsage(threadId, byNode);

      expect(mockCacheService.hmset).toHaveBeenCalledWith(
        'thread:thread-123:tokens',
        {
          node1: JSON.stringify(byNode.node1),
          node2: JSON.stringify(byNode.node2),
        },
      );
      expect(mockCacheService.expire).toHaveBeenCalledWith(
        'thread:thread-123:tokens',
        86400,
      );
    });

    it('should handle errors gracefully', async () => {
      const threadId = 'thread-123';
      const byNode: Record<string, TokenUsage> = {
        node1: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      };

      mockCacheService.hmset.mockRejectedValue(new Error('Redis error'));

      // Should not throw
      await expect(
        service.setThreadTokenUsage(threadId, byNode),
      ).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getThreadTokenUsage', () => {
    it('should retrieve and aggregate token usage from Redis', async () => {
      const threadId = 'thread-123';
      const node1Data: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        totalPrice: 0.001,
      };
      const node2Data: TokenUsage = {
        inputTokens: 200,
        cachedInputTokens: 50,
        outputTokens: 100,
        reasoningTokens: 25,
        totalTokens: 300,
        totalPrice: 0.002,
      };

      mockCacheService.hgetall.mockResolvedValue({
        node1: JSON.stringify(node1Data),
        node2: JSON.stringify(node2Data),
      });

      const result = await service.getThreadTokenUsage(threadId);

      expect(result).toEqual({
        inputTokens: 300,
        cachedInputTokens: 50,
        outputTokens: 150,
        reasoningTokens: 25,
        totalTokens: 450,
        totalPrice: 0.003,
        byNode: {
          node1: node1Data,
          node2: node2Data,
        },
      });
    });

    it('should return null if no data exists in Redis', async () => {
      mockCacheService.hgetall.mockResolvedValue({});

      const result = await service.getThreadTokenUsage('thread-123');

      expect(result).toBeNull();
    });

    it('should handle parse errors gracefully', async () => {
      mockCacheService.hgetall.mockResolvedValue({
        node1: 'invalid json',
        node2: JSON.stringify({
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        }),
      });

      const result = await service.getThreadTokenUsage('thread-123');

      // Should only include node2 that parsed successfully
      expect(result?.byNode).toEqual({
        node2: {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        },
      });
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      mockCacheService.hgetall.mockRejectedValue(new Error('Redis error'));

      const result = await service.getThreadTokenUsage('thread-123');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('flushThreadTokenUsage', () => {
    it('should retrieve token usage and delete from Redis', async () => {
      const threadId = 'thread-123';
      const tokenUsage = {
        inputTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
        totalPrice: 0.003,
        byNode: {
          node1: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
            totalPrice: 0.001,
          },
        },
      };

      mockCacheService.hgetall.mockResolvedValue({
        node1: JSON.stringify(tokenUsage.byNode.node1),
      });

      const result = await service.flushThreadTokenUsage(threadId);

      expect(result).toMatchObject({
        inputTokens: expect.any(Number),
        outputTokens: expect.any(Number),
        totalTokens: expect.any(Number),
        byNode: expect.any(Object),
      });
      expect(mockCacheService.del).toHaveBeenCalledWith(
        'thread:thread-123:tokens',
      );
    });

    it('should return null if no data exists', async () => {
      mockCacheService.hgetall.mockResolvedValue({});

      const result = await service.flushThreadTokenUsage('thread-123');

      expect(result).toBeNull();
      expect(mockCacheService.del).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockCacheService.hgetall.mockRejectedValue(new Error('Redis error'));

      const result = await service.flushThreadTokenUsage('thread-123');

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('deleteThreadTokenUsage', () => {
    it('should delete token usage from Redis', async () => {
      const threadId = 'thread-123';

      await service.deleteThreadTokenUsage(threadId);

      expect(mockCacheService.del).toHaveBeenCalledWith(
        'thread:thread-123:tokens',
      );
    });

    it('should handle errors gracefully', async () => {
      mockCacheService.del.mockRejectedValue(new Error('Redis error'));

      // Should not throw
      await expect(
        service.deleteThreadTokenUsage('thread-123'),
      ).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('getMultipleThreadTokenUsage', () => {
    it('should retrieve token usage for multiple threads in one batch', async () => {
      const thread1 = 'thread-1';
      const thread2 = 'thread-2';
      const thread3 = 'thread-3';

      const node1Data: TokenUsage = {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        totalPrice: 0.001,
      };
      const node2Data: TokenUsage = {
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        totalPrice: 0.002,
      };

      mockCacheService.hmgetall.mockResolvedValue(
        new Map<string, Record<string, string>>([
          [
            'thread:thread-1:tokens',
            {
              node1: JSON.stringify(node1Data),
            } as Record<string, string>,
          ],
          [
            'thread:thread-2:tokens',
            {
              node2: JSON.stringify(node2Data),
            } as Record<string, string>,
          ],
          // thread-3 not in map (not found)
        ]),
      );

      const result = await service.getMultipleThreadTokenUsage([
        thread1,
        thread2,
        thread3,
      ]);

      expect(result.size).toBe(3);
      expect(result.get(thread1)).toMatchObject({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        byNode: { node1: node1Data },
      });
      expect(result.get(thread2)).toMatchObject({
        inputTokens: 200,
        outputTokens: 100,
        totalTokens: 300,
        byNode: { node2: node2Data },
      });
      expect(result.get(thread3)).toBeNull();
    });

    it('should return empty map for empty input', async () => {
      const result = await service.getMultipleThreadTokenUsage([]);

      expect(result.size).toBe(0);
      expect(mockCacheService.hmgetall).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockCacheService.hmgetall.mockRejectedValue(new Error('Redis error'));

      const result = await service.getMultipleThreadTokenUsage([
        'thread-1',
        'thread-2',
      ]);

      // Should return map with null values
      expect(result.size).toBe(2);
      expect(result.get('thread-1')).toBeNull();
      expect(result.get('thread-2')).toBeNull();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
