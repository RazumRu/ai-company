import { BaseMessage } from '@langchain/core/messages';

export class CostLimitExceededError extends Error {
  constructor(
    public readonly effectiveLimitUsd: number,
    public readonly totalPriceUsd: number,
    public readonly inFlightMessages?: BaseMessage[],
  ) {
    super('COST_LIMIT_EXCEEDED');
    this.name = 'CostLimitExceededError';
  }
}
