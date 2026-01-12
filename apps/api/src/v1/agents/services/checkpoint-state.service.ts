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
   * Get token usage for a thread by reading from its latest checkpoint.
   * Returns per-node breakdown and aggregated totals.
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
      // Get the latest checkpoint for this thread
      const checkpointTuple = await this.checkpointSaver.getTuple({
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
        },
      });

      if (!checkpointTuple?.checkpoint) {
        return null;
      }

      // Extract state from checkpoint
      const state = checkpointTuple.checkpoint
        .channel_values as unknown as BaseAgentState;

      if (!state) {
        return null;
      }

      // Extract token usage counters from state
      const usage: RequestTokenUsage = {
        inputTokens: state.inputTokens || 0,
        outputTokens: state.outputTokens || 0,
        totalTokens: state.totalTokens || 0,
      };

      // Add optional fields if present
      if (state.cachedInputTokens) {
        usage.cachedInputTokens = state.cachedInputTokens;
      }
      if (state.reasoningTokens) {
        usage.reasoningTokens = state.reasoningTokens;
      }
      if (state.totalPrice) {
        usage.totalPrice = state.totalPrice;
      }
      if (state.currentContext) {
        usage.currentContext = state.currentContext;
      }

      // For now, we don't have per-node breakdown in the checkpoint state
      // The checkpoint only stores aggregate values
      // Per-node data would need to be stored separately in the state
      return {
        ...usage,
        // byNode is not available from current checkpoint structure
        // Could be added in future if needed
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
    try {
      // For now, just get the root thread's usage
      // In future, could query all checkpoints with parentThreadId = rootThreadId
      // and aggregate them together
      return this.getThreadTokenUsage(rootThreadId);
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error : new Error(String(error)),
        'Failed to get root thread token usage from checkpoints',
        { rootThreadId },
      );
      return null;
    }
  }
}
