import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import type { RequestTokenUsage } from '../../litellm/litellm.types';
import type { ThreadTokenUsage } from '../../threads/dto/threads.dto';
import type { BaseAgentState } from '../agents.types';
import { PgCheckpointSaver } from './pg-checkpoint-saver';

/**
 * Service to query and extract token usage data from LangGraph checkpoints.
 * Provides access to token usage without requiring Redis or ThreadEntity denormalization.
 */
@Injectable()
export class CheckpointStateService {
  constructor(
    private readonly checkpointSaver: PgCheckpointSaver,
    private readonly logger: DefaultLogger,
  ) {}

  /**
   * Get token usage for a thread by reading from all related checkpoints.
   * Aggregates usage across all graphs/agents that share the same parent thread.
   * Returns per-node breakdown and aggregated totals.
   *
   * @param threadId - External thread ID (can be root thread or nested thread)
   * @param checkpointNs - Checkpoint namespace (default: empty string for root threads)
   * @returns Token usage with per-node breakdown, or null if no checkpoint found
   */
  async getThreadTokenUsage(
    threadId: string,
    checkpointNs = '',
  ): Promise<ThreadTokenUsage | null> {
    try {
      // Get all checkpoint tuples for this thread and nested agents
      // includeWrites=false since we only need state data for token usage
      const tuples = await this.checkpointSaver.getTuples(
        threadId,
        checkpointNs,
        false,
      );

      if (tuples.length === 0) {
        return null;
      }

      // Aggregate token usage across all checkpoints
      const byNode = new Map<string, RequestTokenUsage>();
      const totalUsage: RequestTokenUsage = {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        totalPrice: 0,
        currentContext: 0,
      };

      for (const tuple of tuples) {
        const state = tuple.checkpoint
          .channel_values as unknown as BaseAgentState;

        if (!state) {
          continue;
        }

        // Extract usage from this checkpoint
        const usage: RequestTokenUsage = {
          inputTokens: state.inputTokens || 0,
          cachedInputTokens: state.cachedInputTokens || 0,
          outputTokens: state.outputTokens || 0,
          reasoningTokens: state.reasoningTokens || 0,
          totalTokens: state.totalTokens || 0,
          totalPrice: state.totalPrice || 0,
          currentContext: state.currentContext || 0,
        };

        // Aggregate totals
        totalUsage.inputTokens += usage.inputTokens;
        totalUsage.cachedInputTokens! += usage.cachedInputTokens || 0;
        totalUsage.outputTokens += usage.outputTokens;
        totalUsage.reasoningTokens! += usage.reasoningTokens || 0;
        totalUsage.totalTokens += usage.totalTokens;
        totalUsage.totalPrice! += usage.totalPrice || 0;
        totalUsage.currentContext! += usage.currentContext || 0;

        // Add to byNode map if we have a nodeId
        if (tuple.nodeId) {
          byNode.set(tuple.nodeId, usage);
        }
      }

      // Return null if no valid usage data was found
      if (totalUsage.totalTokens === 0 && byNode.size === 0) {
        return null;
      }

      return {
        ...totalUsage,
        byNode: byNode.size > 0 ? Object.fromEntries(byNode) : undefined,
      };
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to get thread token usage from checkpoint',
        { threadId, checkpointNs },
      );
      return null;
    }
  }

  /**
   * Get token usage for a root thread including all nested agent runs.
   * Uses parentThreadId index to find all related checkpoints.
   *
   * @param rootThreadId - Root thread ID (parent_thread_id in config)
   * @returns Aggregated token usage across all nested runs, or null if not found
   */
  async getRootThreadTokenUsage(
    rootThreadId: string,
  ): Promise<ThreadTokenUsage | null> {
    // The updated getThreadTokenUsage now handles aggregation across all
    // related threads, so we can just delegate to it
    return this.getThreadTokenUsage(rootThreadId);
  }
}
