import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiteLLMModelInfo } from '../litellm.types';
import { LitellmService } from './litellm.service';

const buildModelInfo = (
  overrides: Partial<LiteLLMModelInfo['model_info']> = {},
): LiteLLMModelInfo => ({
  model_name: 'gpt-4',
  litellm_params: { model: 'openai/gpt-4' },
  model_info: {
    key: 'gpt-4',
    input_cost_per_token: 0.00003,
    output_cost_per_token: 0.00006,
    ...overrides,
  },
});

const createSvc = (modelInfo: LiteLLMModelInfo | null = null) => {
  return new LitellmService({
    listModels: vi.fn(),
    getModelInfo: vi.fn().mockResolvedValue(modelInfo),
  } as unknown as never);
};

describe('LitellmService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('extractTokenUsageFromResponse', () => {
    it('returns a zeroed usage object when usage_metadata is missing', async () => {
      const svc = createSvc(null);
      await expect(svc.extractTokenUsageFromResponse('gpt-4')).resolves.toEqual(
        {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          currentContext: 0,
          cachedInputTokens: 0,
          reasoningTokens: 0,
          totalPrice: 0,
        },
      );
    });

    it('extracts token usage from usage_metadata', async () => {
      const svc = createSvc(buildModelInfo());

      const result = await svc.extractTokenUsageFromResponse('gpt-4', {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 2 },
      });

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(10);
      expect(result!.outputTokens).toBe(5);
      expect(result!.totalTokens).toBe(15);
      expect(result!.cachedInputTokens).toBe(3);
      expect(result!.reasoningTokens).toBe(2);
    });

    it('extracts token usage with cached tokens', async () => {
      const svc = createSvc(buildModelInfo());

      const result = await svc.extractTokenUsageFromResponse('gpt-4', {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 0 },
      });

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(10);
      expect(result!.outputTokens).toBe(5);
      expect(result!.cachedInputTokens).toBe(3);
    });

    it('calculates price with cached tokens correctly', async () => {
      const svc = createSvc(
        buildModelInfo({ input_cost_per_token_cache_hit: 0.00001 }),
      );

      const result = await svc.extractTokenUsageFromResponse('gpt-4', {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        input_tokens_details: { cached_tokens: 80 },
        output_tokens_details: { reasoning_tokens: 0 },
      });

      expect(result).toBeDefined();
      expect(result!.cachedInputTokens).toBe(80);
      // Should calculate: (20 * 0.00003) + (80 * 0.00001) + (50 * 0.00006)
      // = 0.0006 + 0.0008 + 0.003 = 0.0044
      expect(result!.totalPrice).toBeCloseTo(0.0044, 10);
    });

    it('calculates price when no cached/reasoning tokens', async () => {
      const svc = createSvc(buildModelInfo());

      const result = await svc.extractTokenUsageFromResponse('gpt-4', {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      });

      expect(result).toBeDefined();
      expect(result!.totalPrice).toBeGreaterThan(0);
    });

    it('falls back to provider-reported cost when model rates are unavailable', async () => {
      // Simulate an OpenRouter model not in LiteLLM pricing database
      const svc = createSvc(null);

      const result = await svc.extractTokenUsageFromResponse(
        'openrouter/minimax-m2.5',
        {
          prompt_tokens: 3612,
          completion_tokens: 272,
          total_tokens: 3884,
          prompt_tokens_details: { cached_tokens: 3493 },
          completion_tokens_details: { reasoning_tokens: 106 },
          cost: 0.00046689,
        },
      );

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(3612);
      expect(result!.outputTokens).toBe(272);
      expect(result!.totalTokens).toBe(3884);
      expect(result!.cachedInputTokens).toBe(3493);
      expect(result!.reasoningTokens).toBe(106);
      expect(result!.totalPrice).toBe(0.00046689);
    });

    it('prefers provider-reported cost over calculated price when both available', async () => {
      const svc = createSvc(buildModelInfo());

      const result = await svc.extractTokenUsageFromResponse('gpt-4', {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
        cost: 0.00075, // Provider cost takes precedence (actual upstream charge)
      });

      expect(result).toBeDefined();
      // Should use provider-reported cost, as it reflects the actual upstream charge
      expect(result!.totalPrice).toBe(0.00075);
    });

    it('falls back to calculated price when provider cost is absent', async () => {
      const svc = createSvc(buildModelInfo());

      const result = await svc.extractTokenUsageFromResponse('gpt-4', {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
        // No cost field — should use calculated price
      });

      expect(result).toBeDefined();
      expect(result!.totalPrice).toBeGreaterThan(0);
      // (10 * 0.00003) + (5 * 0.00006) = 0.0003 + 0.0003 = 0.0006
      expect(result!.totalPrice).toBeCloseTo(0.0006, 10);
    });

    it('extracts tokens from OpenRouter prompt_tokens/completion_tokens format', async () => {
      const svc = createSvc(null);

      const result = await svc.extractTokenUsageFromResponse(
        'openrouter/some-model',
        {
          prompt_tokens: 3612,
          completion_tokens: 272,
          total_tokens: 3884,
          prompt_tokens_details: {
            cached_tokens: 3493,
            audio_tokens: 0,
          },
          completion_tokens_details: {
            reasoning_tokens: 106,
            audio_tokens: 0,
          },
          cost: 0.00046689,
        },
      );

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(3612);
      expect(result!.outputTokens).toBe(272);
      expect(result!.totalTokens).toBe(3884);
      expect(result!.cachedInputTokens).toBe(3493);
      expect(result!.reasoningTokens).toBe(106);
      expect(result!.totalPrice).toBe(0.00046689);
    });
  });

  describe('estimateThreadTotalPriceFromModelRates', () => {
    it('calculates price with cached tokens correctly', async () => {
      const svc = createSvc(
        buildModelInfo({ input_cost_per_token_cache_hit: 0.000015 }),
      );

      const price = await svc.estimateThreadTotalPriceFromModelRates({
        model: 'gpt-4',
        inputTokens: 1000,
        cachedInputTokens: 800,
        outputTokens: 100,
        reasoningTokens: 0,
      });

      // (200 * 0.00003) + (800 * 0.000015) + (100 * 0.00006)
      // = 0.006 + 0.012 + 0.006 = 0.024
      expect(price).toBeCloseTo(0.024, 10);
    });
  });

  describe('getTokenCostRatesForModel', () => {
    it('returns cost rates for a model', async () => {
      const svc = createSvc(
        buildModelInfo({ input_cost_per_token_cache_hit: 0.000015 }),
      );

      const rates = await svc.getTokenCostRatesForModel('gpt-4');

      expect(rates).toEqual({
        inputCostPerToken: 0.00003,
        outputCostPerToken: 0.00006,
        inputCostPerCachedToken: 0.000015,
      });
    });

    it('returns null for unknown model', async () => {
      const svc = createSvc(null);

      const rates = await svc.getTokenCostRatesForModel('unknown-model');

      expect(rates).toBeNull();
    });
  });

  describe('sumTokenUsages', () => {
    it('sums multiple token usages', () => {
      const svc = createSvc();
      const result = svc.sumTokenUsages([
        {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          totalPrice: 0.001,
          currentContext: 10,
        },
        {
          inputTokens: 20,
          cachedInputTokens: 15,
          outputTokens: 10,
          totalTokens: 30,
          totalPrice: 0.002,
          currentContext: 20,
        },
      ]);

      expect(result).toEqual({
        inputTokens: 30,
        cachedInputTokens: 15,
        outputTokens: 15,
        totalTokens: 45,
        totalPrice: 0.003,
        currentContext: 20, // Max of all contexts
      });
    });

    it('sums durationMs across usages', () => {
      const svc = createSvc();
      const result = svc.sumTokenUsages([
        {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
          durationMs: 1500,
        },
        {
          inputTokens: 20,
          outputTokens: 10,
          totalTokens: 30,
          durationMs: 2300,
        },
      ]);

      expect(result).toEqual({
        inputTokens: 30,
        outputTokens: 15,
        totalTokens: 45,
        durationMs: 3800,
      });
    });

    it('omits durationMs when no usages have it', () => {
      const svc = createSvc();
      const result = svc.sumTokenUsages([
        { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      ]);

      expect(result).not.toHaveProperty('durationMs');
    });
  });
});
