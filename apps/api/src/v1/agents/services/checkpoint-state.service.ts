import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import Decimal from 'decimal.js';

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
   * Get token usage for a thread by reading from its latest checkpoint.
   * Fetches the root thread checkpoint plus any nested agent checkpoints
   * (linked via parentThreadId) for multi-agent graphs.
   * Subagent checkpoints (threadId "subagent-*") are excluded because their
   * token usage is already folded into the parent checkpoint by
   * tool-executor-node.
   *
   * @param threadId - External thread ID
   * @param checkpointNs - Checkpoint namespace (default: empty string for root threads)
   * @returns Token usage with per-node breakdown, or null if no checkpoint found
   */
  async getThreadTokenUsage(
    threadId: string,
    checkpointNs = '',
  ): Promise<ThreadTokenUsage | null> {
    try {
      // Get checkpoint tuples for this thread and any nested agents (multi-agent graphs).
      // includeWrites=false since we only need state data for token usage
      const tuples = await this.checkpointSaver.getTuples(
        threadId,
        checkpointNs,
        false,
      );

      if (tuples.length === 0) {
        return null;
      }

      // Aggregate token usage across all checkpoints.
      // Use Decimal.js for totalPrice to avoid floating-point rounding errors.
      const byNode = new Map<string, RequestTokenUsage>();
      let inputTokens = 0;
      let cachedInputTokens = 0;
      let outputTokens = 0;
      let reasoningTokens = 0;
      let totalTokens = 0;
      let totalPriceDecimal = new Decimal(0);
      // currentContext is a point-in-time measurement, not additive — take max
      let maxCurrentContext = 0;

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
        inputTokens += usage.inputTokens;
        cachedInputTokens += usage.cachedInputTokens || 0;
        outputTokens += usage.outputTokens;
        reasoningTokens += usage.reasoningTokens || 0;
        totalTokens += usage.totalTokens;
        totalPriceDecimal = totalPriceDecimal.plus(usage.totalPrice || 0);
        maxCurrentContext = Math.max(
          maxCurrentContext,
          usage.currentContext || 0,
        );

        // Add to byNode map if we have a nodeId
        if (tuple.nodeId) {
          byNode.set(tuple.nodeId, usage);
        }
      }

      // Return null if no valid usage data was found
      if (totalTokens === 0 && byNode.size === 0) {
        return null;
      }

      return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningTokens,
        totalTokens,
        totalPrice: totalPriceDecimal.toNumber(),
        currentContext: maxCurrentContext,
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
}
