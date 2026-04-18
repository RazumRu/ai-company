import { describe, expect, it } from 'vitest';

import { CostLimitExceededError } from './agents.errors';

describe('agents.errors', () => {
  describe('CostLimitExceededError', () => {
    it('should be an instance of Error', () => {
      const error = new CostLimitExceededError(1.5, 2.0);

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(CostLimitExceededError);
    });

    it('should set name to "CostLimitExceededError"', () => {
      const error = new CostLimitExceededError(1.5, 2.0);

      expect(error.name).toBe('CostLimitExceededError');
    });

    it('should set message to "COST_LIMIT_EXCEEDED"', () => {
      const error = new CostLimitExceededError(1.5, 2.0);

      expect(error.message).toBe('COST_LIMIT_EXCEEDED');
    });

    it('should preserve effectiveLimitUsd and totalPriceUsd fields from constructor', () => {
      const error = new CostLimitExceededError(0.25, 0.37);

      expect(error.effectiveLimitUsd).toBe(0.25);
      expect(error.totalPriceUsd).toBe(0.37);
    });

    it('should preserve zero values for effectiveLimitUsd and totalPriceUsd', () => {
      const error = new CostLimitExceededError(0, 0);

      expect(error.effectiveLimitUsd).toBe(0);
      expect(error.totalPriceUsd).toBe(0);
    });

    it('should distinguish CostLimitExceededError from other Error subclasses via instanceof', () => {
      const costError = new CostLimitExceededError(1, 2);
      const otherError = new TypeError('some type error');
      const plainError = new Error('plain error');

      expect(costError instanceof CostLimitExceededError).toBe(true);
      expect(otherError instanceof CostLimitExceededError).toBe(false);
      expect(plainError instanceof CostLimitExceededError).toBe(false);
    });
  });
});
