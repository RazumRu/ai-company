export class CostLimitExceededError extends Error {
  constructor(
    public readonly effectiveLimitUsd: number,
    public readonly totalPriceUsd: number,
  ) {
    super('COST_LIMIT_EXCEEDED');
    this.name = 'CostLimitExceededError';
  }
}
