import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import type { TokenUsage } from '../../litellm/litellm.types';
import type { ThreadTokenUsage } from '../../threads/dto/threads.dto';
import { CacheService } from './cache.service';

/**
 * Domain-specific cache service for managing thread token usage in Redis.
 * Stores per-node token usage during graph execution and flushes to DB on completion.
 */
@Injectable()
export class ThreadTokenUsageCacheService {
  private readonly KEY_PREFIX = 'thread';
  private readonly KEY_SUFFIX = 'tokens';
  private readonly TTL_SECONDS = 86400; // 24 hours

  constructor(
    private readonly cacheService: CacheService,
    private readonly logger: DefaultLogger,
  ) {}

  /**
   * Generate Redis key for thread token usage
   */
  private getKey(externalThreadId: string): string {
    return `${this.KEY_PREFIX}:${externalThreadId}:${this.KEY_SUFFIX}`;
  }

  private normalizeTokenUsage(
    value: Partial<TokenUsage> | null | undefined,
  ): TokenUsage {
    const v = value ?? {};
    return {
      inputTokens: typeof v.inputTokens === 'number' ? v.inputTokens : 0,
      cachedInputTokens:
        typeof v.cachedInputTokens === 'number'
          ? v.cachedInputTokens
          : undefined,
      outputTokens: typeof v.outputTokens === 'number' ? v.outputTokens : 0,
      reasoningTokens:
        typeof v.reasoningTokens === 'number' ? v.reasoningTokens : undefined,
      totalTokens: typeof v.totalTokens === 'number' ? v.totalTokens : 0,
      totalPrice: typeof v.totalPrice === 'number' ? v.totalPrice : undefined,
      currentContext:
        typeof v.currentContext === 'number' ? v.currentContext : undefined,
    };
  }

  /**
   * Aggregate token usage from per-node data
   */
  private aggregateTokens(byNode: Record<string, TokenUsage>): TokenUsage {
    const nodes = Object.values(byNode);
    if (nodes.length === 0) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
    }

    const aggregated: TokenUsage = {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      totalPrice: 0,
      currentContext: 0,
    };

    for (const usage of nodes) {
      aggregated.inputTokens += usage.inputTokens || 0;
      aggregated.cachedInputTokens! += usage.cachedInputTokens || 0;
      aggregated.outputTokens += usage.outputTokens || 0;
      aggregated.reasoningTokens! += usage.reasoningTokens || 0;
      aggregated.totalTokens += usage.totalTokens || 0;
      aggregated.totalPrice! += usage.totalPrice || 0;
      // currentContext is a snapshot; use max across nodes as a stable thread-level view
      aggregated.currentContext = Math.max(
        aggregated.currentContext ?? 0,
        usage.currentContext ?? 0,
      );
    }

    // Clean up optional fields if they're zero
    const result: TokenUsage = {
      inputTokens: aggregated.inputTokens,
      outputTokens: aggregated.outputTokens,
      totalTokens: aggregated.totalTokens,
    };

    if (aggregated.cachedInputTokens && aggregated.cachedInputTokens > 0) {
      result.cachedInputTokens = aggregated.cachedInputTokens;
    }
    if (aggregated.reasoningTokens && aggregated.reasoningTokens > 0) {
      result.reasoningTokens = aggregated.reasoningTokens;
    }
    if (aggregated.totalPrice && aggregated.totalPrice > 0) {
      result.totalPrice = aggregated.totalPrice;
    }
    if (aggregated.currentContext && aggregated.currentContext > 0) {
      result.currentContext = aggregated.currentContext;
    }

    return result;
  }

  /**
   * Store thread token usage in Redis
   * @param externalThreadId The external thread ID
   * @param byNode Per-node token usage breakdown
   */
  async setThreadTokenUsage(
    externalThreadId: string,
    byNode: Record<string, TokenUsage>,
  ): Promise<void> {
    const key = this.getKey(externalThreadId);

    try {
      // Serialize per-node data as JSON strings for hash storage
      const hashData: Record<string, string> = {};
      for (const [nodeId, usage] of Object.entries(byNode)) {
        hashData[nodeId] = JSON.stringify(this.normalizeTokenUsage(usage));
      }

      // Store in Redis
      await this.cacheService.hmset(key, hashData);
      await this.cacheService.expire(key, this.TTL_SECONDS);

      this.logger.debug('Stored thread token usage in Redis', {
        threadId: externalThreadId,
        nodeCount: Object.keys(byNode).length,
      });
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to store thread token usage in Redis',
        { threadId: externalThreadId },
      );
      // Don't throw - cache failures should not break the flow
    }
  }

  /**
   * Upsert token usage for a single node within a thread.
   * This is used from state update notifications where only a subset of fields is present.
   */
  async upsertNodeTokenUsage(
    externalThreadId: string,
    nodeId: string,
    patch: Partial<TokenUsage>,
  ): Promise<void> {
    const key = this.getKey(externalThreadId);

    const hasAny =
      patch.inputTokens !== undefined ||
      patch.cachedInputTokens !== undefined ||
      patch.outputTokens !== undefined ||
      patch.reasoningTokens !== undefined ||
      patch.totalTokens !== undefined ||
      patch.totalPrice !== undefined ||
      patch.currentContext !== undefined;

    if (!hasAny) return;

    try {
      const existingRaw = await this.cacheService.hget(key, nodeId);
      const existing = existingRaw
        ? this.normalizeTokenUsage(
            JSON.parse(existingRaw) as Partial<TokenUsage>,
          )
        : this.normalizeTokenUsage(undefined);

      const merged = this.normalizeTokenUsage({ ...existing, ...patch });
      await this.cacheService.hset(key, nodeId, JSON.stringify(merged));
      await this.cacheService.expire(key, this.TTL_SECONDS);
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to upsert node token usage in Redis',
        { threadId: externalThreadId, nodeId },
      );
    }
  }

  /**
   * Retrieve thread token usage from Redis
   * @param externalThreadId The external thread ID
   * @returns Aggregated token usage with per-node breakdown, or null if not found
   */
  async getThreadTokenUsage(
    externalThreadId: string,
  ): Promise<ThreadTokenUsage | null> {
    const key = this.getKey(externalThreadId);

    try {
      const hashData = await this.cacheService.hgetall(key);

      if (!hashData || Object.keys(hashData).length === 0) {
        return null;
      }

      // Deserialize per-node data
      const byNode: Record<string, TokenUsage> = {};
      for (const [nodeId, jsonStr] of Object.entries(hashData)) {
        try {
          byNode[nodeId] = this.normalizeTokenUsage(
            JSON.parse(jsonStr) as Partial<TokenUsage>,
          );
        } catch (parseError) {
          this.logger.warn('Failed to parse token usage for node', {
            threadId: externalThreadId,
            nodeId,
            error: parseError,
          });
        }
      }

      // Aggregate totals
      const totals = this.aggregateTokens(byNode);

      return {
        ...totals,
        byNode,
      };
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to retrieve thread token usage from Redis',
        { threadId: externalThreadId },
      );
      return null;
    }
  }

  /**
   * Flush thread token usage from Redis (retrieve and delete)
   * Used when thread completes to persist data to database
   * @param externalThreadId The external thread ID
   * @returns Token usage data, or null if not found
   */
  async flushThreadTokenUsage(
    externalThreadId: string,
  ): Promise<ThreadTokenUsage | null> {
    const key = this.getKey(externalThreadId);

    try {
      // Get the data
      const tokenUsage = await this.getThreadTokenUsage(externalThreadId);

      // Delete from Redis
      if (tokenUsage) {
        await this.cacheService.del(key);
        this.logger.debug('Flushed thread token usage from Redis', {
          threadId: externalThreadId,
        });
      }

      return tokenUsage;
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to flush thread token usage from Redis',
        { threadId: externalThreadId },
      );
      return null;
    }
  }

  /**
   * Delete thread token usage from Redis
   * Used when thread is deleted
   * @param externalThreadId The external thread ID
   */
  async deleteThreadTokenUsage(externalThreadId: string): Promise<void> {
    const key = this.getKey(externalThreadId);

    try {
      await this.cacheService.del(key);
      this.logger.debug('Deleted thread token usage from Redis', {
        threadId: externalThreadId,
      });
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to delete thread token usage from Redis',
        { threadId: externalThreadId },
      );
      // Don't throw - cache cleanup failures should not break the flow
    }
  }

  /**
   * Retrieve token usage for multiple threads in a single batch operation
   * @param externalThreadIds Array of external thread IDs
   * @returns Map of external thread ID to token usage (or null if not found)
   */
  async getMultipleThreadTokenUsage(
    externalThreadIds: string[],
  ): Promise<Map<string, ThreadTokenUsage | null>> {
    const resultMap = new Map<string, ThreadTokenUsage | null>();

    if (externalThreadIds.length === 0) {
      return resultMap;
    }

    try {
      // Generate all keys
      const keys = externalThreadIds.map((id) => this.getKey(id));

      // Fetch all hash data in one batch operation
      const hashDataMap = await this.cacheService.hmgetall(keys);

      // Process each thread
      for (let i = 0; i < externalThreadIds.length; i++) {
        const threadId = externalThreadIds[i];
        const key = keys[i];

        if (!threadId || !key) continue;

        const hashData = hashDataMap.get(key);

        if (!hashData || Object.keys(hashData).length === 0) {
          resultMap.set(threadId, null);
          continue;
        }

        // Deserialize per-node data
        const byNode: Record<string, TokenUsage> = {};
        for (const [nodeId, jsonStr] of Object.entries(hashData)) {
          try {
            byNode[nodeId] = this.normalizeTokenUsage(
              JSON.parse(jsonStr) as Partial<TokenUsage>,
            );
          } catch (parseError) {
            this.logger.warn('Failed to parse token usage for node', {
              threadId,
              nodeId,
              error: parseError,
            });
          }
        }

        // Aggregate totals
        const totals = this.aggregateTokens(byNode);

        resultMap.set(threadId, {
          ...totals,
          byNode,
        });
      }

      this.logger.debug('Retrieved multiple thread token usages from Redis', {
        requestedCount: externalThreadIds.length,
        foundCount: Array.from(resultMap.values()).filter((v) => v !== null)
          .length,
      });

      return resultMap;
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to retrieve multiple thread token usages from Redis',
        { threadCount: externalThreadIds.length },
      );
      // Return empty map on error
      for (const threadId of externalThreadIds) {
        resultMap.set(threadId, null);
      }
      return resultMap;
    }
  }
}
