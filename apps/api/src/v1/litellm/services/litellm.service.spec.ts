import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LitellmService } from './litellm.service';

const createSvc = () =>
  new LitellmService({ listModels: vi.fn() } as unknown as never);

describe('LitellmService (utils)', () => {
  describe('extractTokenUsageFromResponse', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns null when usage_metadata is missing or not an object', () => {
      const svc = createSvc();
      expect(
        svc.extractTokenUsageFromResponse({
          usage_metadata: undefined,
          response_metadata: {},
        }),
      ).toBeNull();

      expect(
        svc.extractTokenUsageFromResponse({
          usage_metadata: 'not-an-object',
          response_metadata: {},
        }),
      ).toBeNull();
    });

    it('extracts token usage fields and prefers usage_metadata.total_tokens', () => {
      const svc = createSvc();
      const result = svc.extractTokenUsageFromResponse({
        usage_metadata: {
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 20,
          input_tokens_details: { cached_tokens: 3 },
          output_tokens_details: { reasoning_tokens: 2 },
        },
        response_metadata: {},
      });

      expect(result).toEqual({
        inputTokens: 10,
        cachedInputTokens: 3,
        outputTokens: 5,
        reasoningTokens: 2,
        totalTokens: 20,
      });
    });

    it('reads response_metadata.response_cost when present', () => {
      const svc = createSvc();
      const result = svc.extractTokenUsageFromResponse({
        usage_metadata: {
          input_tokens: 1,
          output_tokens: 2,
          total_tokens: 3,
        },
        response_metadata: {
          response_cost: 0.9,
        },
      });

      expect(result).toEqual({
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        totalPrice: 0.9,
      });
    });

    it('reads response_metadata._hidden_params.response_cost when response_cost is absent', () => {
      const svc = createSvc();
      const result = svc.extractTokenUsageFromResponse({
        usage_metadata: {
          input_tokens: 2,
          output_tokens: 3,
          total_tokens: 5,
        },
        response_metadata: {
          _hidden_params: {
            response_cost: 1.23,
          },
        },
      });

      expect(result).toEqual({
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
        totalPrice: 1.23,
      });
    });

    it('omits totalPrice when it cannot be determined', () => {
      const svc = createSvc();
      const result = svc.extractTokenUsageFromResponse({
        usage_metadata: {
          input_tokens: 2,
          output_tokens: 3,
        },
        response_metadata: {
          response_cost: 'not-a-number',
          _hidden_params: {
            response_cost: null,
          },
        },
      });

      expect(result).toEqual({
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
      });
    });
  });

  describe('extractTokenUsageFromAdditionalKwargs', () => {
    it('extracts tokenUsage from a single additionalKwargs object', () => {
      const svc = createSvc();
      expect(
        svc.extractTokenUsageFromAdditionalKwargs({
          tokenUsage: {
            inputTokens: 1,
            cachedInputTokens: 2,
            outputTokens: 3,
            reasoningTokens: 4,
            totalTokens: 8,
            totalPrice: 0.5,
          },
        }),
      ).toEqual({
        inputTokens: 1,
        cachedInputTokens: 2,
        outputTokens: 3,
        reasoningTokens: 4,
        totalTokens: 8,
        totalPrice: 0.5,
      });
    });

    it('returns null when tokenUsage is missing/invalid', () => {
      const svc = createSvc();
      expect(svc.extractTokenUsageFromAdditionalKwargs(undefined)).toBeNull();
      expect(svc.extractTokenUsageFromAdditionalKwargs({})).toBeNull();
      expect(
        svc.extractTokenUsageFromAdditionalKwargs({ tokenUsage: 'nope' }),
      ).toBeNull();
      expect(
        svc.extractTokenUsageFromAdditionalKwargs({
          tokenUsage: { inputTokens: 1, outputTokens: 2 }, // missing totalTokens
        }),
      ).toBeNull();
    });

    it('accepts an array and returns aggregated totals', () => {
      const svc = createSvc();
      expect(
        svc.extractTokenUsageFromAdditionalKwargs([
          {
            tokenUsage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15,
              totalPrice: 0.1,
            },
          },
          undefined,
          {
            tokenUsage: {
              inputTokens: 1,
              cachedInputTokens: 2,
              outputTokens: 3,
              reasoningTokens: 4,
              totalTokens: 8,
            },
          },
        ]),
      ).toEqual({
        inputTokens: 11,
        cachedInputTokens: 2,
        outputTokens: 8,
        reasoningTokens: 4,
        totalTokens: 23,
        totalPrice: 0.1,
      });
    });

    it('returns null when array contains no extractable entries', () => {
      const svc = createSvc();
      expect(
        svc.extractTokenUsageFromAdditionalKwargs([undefined, null, {}]),
      ).toBeNull();
    });
  });

  describe('LiteLLM model pricing + cost estimation', () => {
    beforeEach(() => {
      vi.unstubAllGlobals();
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('estimates thread totalPrice from cached model pricing (12h cache)', async () => {
      const svc = createSvc();
      svc.resetLiteLLMModelPricesCacheForTests();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          'gpt-4': {
            input_cost_per_token: 0.00003,
            input_cost_per_token_cache_hit: 0.00001,
            output_cost_per_token: 0.00006,
            output_cost_per_reasoning_token: 0.00002,
          },
        }),
      });
      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      const price1 = await svc.estimateThreadTotalPriceFromModelRates({
        model: 'gpt-4',
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 5,
        reasoningTokens: 1,
      });
      expect(price1).toBeCloseTo(
        8 * 0.00003 + 2 * 0.00001 + 5 * 0.00006 + 1 * 0.00002,
        10,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const price2 = await svc.estimateThreadTotalPriceFromModelRates({
        model: 'gpt-4',
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
      });
      expect(price2).toBeCloseTo(1 * 0.00003 + 1 * 0.00006, 10);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.setSystemTime(new Date('2025-01-01T12:00:00.001Z'));
      await svc.estimateThreadTotalPriceFromModelRates({
        model: 'gpt-4',
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('estimates message totalPrice by direction (input/output/reasoning)', async () => {
      const svc = createSvc();
      svc.resetLiteLLMModelPricesCacheForTests();
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          modelA: {
            input_cost_per_token: 1,
            output_cost_per_token: 2,
            output_cost_per_reasoning_token: 3,
          },
        }),
      });
      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      await expect(
        svc.estimateMessageTotalPriceFromModelRates({
          model: 'modelA',
          direction: 'input',
          totalTokens: 2,
        }),
      ).resolves.toBe(2);

      await expect(
        svc.estimateMessageTotalPriceFromModelRates({
          model: 'modelA',
          direction: 'output',
          totalTokens: 2,
        }),
      ).resolves.toBe(4);

      await expect(
        svc.estimateMessageTotalPriceFromModelRates({
          model: 'modelA',
          direction: 'reasoning',
          totalTokens: 2,
        }),
      ).resolves.toBe(6);
    });

    it('extracts token usage and falls back to model rates when response_cost is missing', async () => {
      const svc = createSvc();
      svc.resetLiteLLMModelPricesCacheForTests();

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          'gpt-4': {
            input_cost_per_token: 0.00003,
            output_cost_per_token: 0.00006,
          },
        }),
      });
      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

      const usage = await svc.extractTokenUsageFromResponseWithPriceFallback({
        model: 'gpt-4',
        usage_metadata: {
          input_tokens: 2,
          output_tokens: 3,
          total_tokens: 5,
        },
        response_metadata: {},
      });

      expect(usage).toEqual({
        inputTokens: 2,
        outputTokens: 3,
        totalTokens: 5,
        totalPrice: 2 * 0.00003 + 3 * 0.00006,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // When response_cost is already present, do not fetch prices.
      const usage2 = await svc.extractTokenUsageFromResponseWithPriceFallback({
        model: 'gpt-4',
        usage_metadata: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
        },
        response_metadata: { response_cost: 0.123 },
      });
      expect(usage2).toEqual({
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        totalPrice: 0.123,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
