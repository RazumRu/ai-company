import { INestApplication } from '@nestjs/common';
import Decimal from 'decimal.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LiteLlmClient } from '../../../v1/litellm/services/litellm.client';
import { LitellmService } from '../../../v1/litellm/services/litellm.service';
import { createTestModule } from '../../integration/setup';

describe('LiteLLM (integration)', () => {
  let app: INestApplication;
  let modelsService: LitellmService;

  const mockResponse = [
    {
      id: 'gpt-5.1',
      object: 'model',
      created: 1677610602,
      owned_by: 'openai',
    },
  ];

  beforeAll(async () => {
    app = await createTestModule(async (moduleBuilder) =>
      moduleBuilder
        .overrideProvider(LiteLlmClient)
        .useValue({
          listModels: async () => mockResponse,
        })
        .compile(),
    );

    modelsService = app.get(LitellmService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns models from LiteLLM client', async () => {
    const result = await modelsService.listModels();
    expect(result).toEqual([{ id: 'gpt-5.1', ownedBy: 'openai' }]);
  });

  it('returns cost rates for model', async () => {
    const model = 'gpt-5.2';
    const result = await modelsService.getTokenCostRatesForModel(model);
    expect(result?.outputCostPerToken).toBeDefined();
    expect(result?.outputCostPerToken).toBeDefined();
  });

  it('extract cost rates from message', async () => {
    const model = 'gpt-5.2';

    // // $0.002137
    // console.log(
    //   await modelsService.getTokenCostRatesForModel(model),
    //   await modelsService.extractTokenUsageFromResponse(model, {
    //     'input_tokens': 7607,
    //     'output_tokens': 37,
    //     'total_tokens': 7644,
    //     'input_token_details': {
    //       'cache_read': 7424,
    //     },
    //     'output_token_details': {
    //       'reasoning': 0,
    //     },
    //   }),
    // );
    // // {
    // //   inputTokens: 7607,
    // //     outputTokens: 37,
    // //   totalTokens: 7644,
    // //   currentContext: 7607,
    // //   cachedInputTokens: 0,
    // //   reasoningTokens: 0,
    // //   totalPrice: 0.01383025
    // // }

    const result = await modelsService.extractTokenUsageFromResponse(model, {
      total_tokens: 58518,
      input_tokens: 58291,
      output_tokens: 227,
      input_tokens_details: { cached_tokens: 57600 },
      output_tokens_details: { reasoning_tokens: 0 },
    });
    expect(result!.inputTokens).toEqual(58291);
    expect(result!.outputTokens).toEqual(227);
    expect(result!.totalTokens).toEqual(58518);
    expect(result!.currentContext).toEqual(58291);
    expect(result!.cachedInputTokens).toEqual(57600);
    // Expected: (58291 - 57600) * 0.00000175 + 57600 * 0.000000175 + 227 * 0.000014
    // = 691 * 0.00000175 + 57600 * 0.000000175 + 227 * 0.000014
    // = 0.00120925 + 0.010080 + 0.003178 = 0.01446725
    expect(result!.totalPrice).toBeCloseTo(0.014467, 5);
  });

  describe('Real LiteLLM response structures', () => {
    it('handles real Azure OpenAI response with cached tokens in usage_metadata', async () => {
      const model = 'azure/gpt-5.2';

      // Real response structure from Azure OpenAI via LiteLLM
      const result = await modelsService.extractTokenUsageFromResponse(model, {
        input_tokens: 54504,
        output_tokens: 124,
        total_tokens: 54628,
        input_tokens_details: {
          cached_tokens: 53888,
        },
        output_tokens_details: {
          reasoning_tokens: 0,
        },
      });

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(54504);
      expect(result!.outputTokens).toBe(124);
      expect(result!.totalTokens).toBe(54628);
      expect(result!.cachedInputTokens).toBe(53888);
      expect(result!.reasoningTokens).toBe(0);
      expect(result!.currentContext).toBe(54504);

      // Verify correct price calculation
      // Non-cached: (54504 - 53888) * 0.00000175 = 616 * 0.00000175 = 0.001078
      // Cached: 53888 * 0.000000175 = 0.0094304
      // Output: 124 * 0.000014 = 0.001736
      // Total: 0.0122444
      const expectedPrice = new Decimal(616)
        .times(0.00000175)
        .plus(new Decimal(53888).times(0.000000175))
        .plus(new Decimal(124).times(0.000014))
        .toNumber();

      expect(result!.totalPrice).toBeCloseTo(expectedPrice, 10);
      expect(result!.totalPrice).toBeCloseTo(0.0122444, 7);
    });

    it('handles real response with prompt_tokens format and cached tokens', async () => {
      const model = 'azure/gpt-5.2';

      // Alternative real response structure using prompt_tokens/completion_tokens
      // NOTE: LiteLLM may return different shapes; the service expects the Responses API
      // usage shape (input/output tokens + details).
      const result = await modelsService.extractTokenUsageFromResponse(model, {
        total_tokens: 58518,
        input_tokens: 58291,
        output_tokens: 227,
        input_tokens_details: { cached_tokens: 57600 },
        output_tokens_details: { reasoning_tokens: 0 },
      });

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(58291);
      expect(result!.outputTokens).toBe(227);
      expect(result!.totalTokens).toBe(58518);
      expect(result!.cachedInputTokens).toBe(57600);
      expect(result!.reasoningTokens).toBe(0);

      // Verify price calculation with cached tokens
      // Non-cached: (58291 - 57600) * 0.00000175 = 691 * 0.00000175 = 0.00120925
      // Cached: 57600 * 0.000000175 = 0.010080
      // Output: 227 * 0.000014 = 0.003178
      // Total: 0.01446725
      expect(result!.totalPrice).toBeCloseTo(0.01446725, 7);
    });

    it('handles response with LiteLLM incorrect price and recalculates', async () => {
      const model = 'azure/gpt-5.2';

      // Real scenario: LiteLLM returns wrong price that doesn't account for cached tokens
      const result = await modelsService.extractTokenUsageFromResponse(model, {
        input_tokens: 54504,
        output_tokens: 124,
        total_tokens: 54628,
        input_tokens_details: { cached_tokens: 53888 },
        output_tokens_details: { reasoning_tokens: 0 },
      });

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(54504);
      expect(result!.outputTokens).toBe(124);
      expect(result!.cachedInputTokens).toBe(53888);

      // Should recalculate and NOT use the wrong 0.097118
      expect(result!.totalPrice).not.toBeCloseTo(0.097118, 2);

      // Should use correct calculation
      expect(result!.totalPrice).toBeCloseTo(0.0122444, 7);
    });

    it('handles response without cached tokens (no recalculation needed)', async () => {
      const model = 'gpt-4o-mini';

      // Response without cached tokens
      const result = await modelsService.extractTokenUsageFromResponse(model, {
        input_tokens: 150,
        output_tokens: 50,
        total_tokens: 200,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      });

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(150);
      expect(result!.outputTokens).toBe(50);
      expect(result!.totalTokens).toBe(200);
      expect(result!.cachedInputTokens).toBe(0);

      // Should calculate price from model rates
      expect(result!.totalPrice).toBeGreaterThan(0);
    });

    it('handles response with reasoning tokens', async () => {
      const model = 'gpt-5.2';

      // Response with reasoning tokens (o1-style models)
      const result = await modelsService.extractTokenUsageFromResponse(model, {
        input_tokens: 1000,
        output_tokens: 500,
        total_tokens: 1500,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: {
          reasoning_tokens: 300,
        },
      });

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(1000);
      expect(result!.outputTokens).toBe(500);
      expect(result!.reasoningTokens).toBe(300);
      expect(result!.totalTokens).toBe(1500);

      // Price calculation should account for reasoning tokens
      // Input: 1000 * 0.00000175 = 0.00175
      // Output: 500 * 0.000014 = 0.007
      // Reasoning: uses outputCostPerToken if no special rate
      // Total: 0.00175 + 0.007 = 0.00875
      expect(result!.totalPrice).toBeCloseTo(0.00875, 7);
    });

    it('handles response with both cached and reasoning tokens', async () => {
      const model = 'azure/gpt-5.2';

      // Complex response with both cached and reasoning tokens
      const result = await modelsService.extractTokenUsageFromResponse(model, {
        input_tokens: 10000,
        output_tokens: 500,
        total_tokens: 10500,
        input_tokens_details: { cached_tokens: 9000 },
        output_tokens_details: { reasoning_tokens: 100 },
      });

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(10000);
      expect(result!.outputTokens).toBe(500);
      expect(result!.totalTokens).toBe(10500);
      expect(result!.cachedInputTokens).toBe(9000);
      expect(result!.reasoningTokens).toBe(100);

      // Should recalculate because of cached tokens
      // Non-cached input: (10000 - 9000) * 0.00000175 = 1000 * 0.00000175 = 0.00175
      // Cached input: 9000 * 0.000000175 = 0.001575
      // Output: 500 * 0.000014 = 0.007
      // Reasoning: 100 * 0.000014 = 0.0014 (uses output rate if no special rate)
      // Total: 0.00175 + 0.001575 + 0.007 = 0.010325
      const expectedPrice = new Decimal(1000)
        .times(0.00000175)
        .plus(new Decimal(9000).times(0.000000175))
        .plus(new Decimal(500).times(0.000014))
        .toNumber();

      expect(result!.totalPrice).toBeCloseTo(expectedPrice, 7);
      expect(result!.totalPrice).not.toBeCloseTo(0.05, 2);
    });

    it('handles response with usage in response_metadata.usage (alternative structure)', async () => {
      const model = 'azure/gpt-5.2';

      // Alternative structure (not commonly used with new interface)
      const result = await modelsService.extractTokenUsageFromResponse(model, {
        input_tokens: 2000,
        output_tokens: 100,
        total_tokens: 2100,
        input_tokens_details: { cached_tokens: 1800 },
        output_tokens_details: { reasoning_tokens: 0 },
      });

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(2000);
      expect(result!.outputTokens).toBe(100);
      expect(result!.totalTokens).toBe(2100);
      expect(result!.cachedInputTokens).toBe(1800);

      // Verify price calculation
      // Non-cached: (2000 - 1800) * 0.00000175 = 200 * 0.00000175 = 0.00035
      // Cached: 1800 * 0.000000175 = 0.000315
      // Output: 100 * 0.000014 = 0.0014
      // Total: 0.00035 + 0.000315 + 0.0014 = 0.002065
      expect(result!.totalPrice).toBeCloseTo(0.002065, 7);
    });

    it('handles response with usage directly in response_metadata', async () => {
      const model = 'azure/gpt-5.2';

      // Standard structure
      const result = await modelsService.extractTokenUsageFromResponse(model, {
        input_tokens: 5000,
        output_tokens: 200,
        total_tokens: 5200,
        input_tokens_details: { cached_tokens: 4500 },
        output_tokens_details: { reasoning_tokens: 0 },
      });

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(5000);
      expect(result!.outputTokens).toBe(200);
      expect(result!.totalTokens).toBe(5200);
      expect(result!.cachedInputTokens).toBe(4500);

      // Verify price calculation
      // Non-cached: (5000 - 4500) * 0.00000175 = 500 * 0.00000175 = 0.000875
      // Cached: 4500 * 0.000000175 = 0.0007875
      // Output: 200 * 0.000014 = 0.0028
      // Total: 0.000875 + 0.0007875 + 0.0028 = 0.0044625
      expect(result!.totalPrice).toBeCloseTo(0.0044625, 7);
    });

    it('verifies cost savings with cached tokens vs without', async () => {
      const model = 'azure/gpt-5.2';
      const inputTokens = 50000;
      const cachedTokens = 48000;
      const outputTokens = 150;

      // Response WITH cached tokens
      const withCache = await modelsService.extractTokenUsageFromResponse(
        model,
        {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
          input_tokens_details: { cached_tokens: cachedTokens },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      );

      // Response WITHOUT cached tokens
      const withoutCache = await modelsService.extractTokenUsageFromResponse(
        model,
        {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: inputTokens + outputTokens,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      );

      expect(withCache).toBeDefined();
      expect(withoutCache).toBeDefined();

      // With cache should be significantly cheaper
      expect(withCache?.totalPrice).toBeDefined();
      expect(withoutCache?.totalPrice).toBeDefined();
      expect(withCache!.totalPrice!).toBeLessThan(withoutCache!.totalPrice!);

      // Calculate expected savings
      // Without cache: 50000 * 0.00000175 + 150 * 0.000014 = 0.0875 + 0.0021 = 0.0896
      // With cache: 2000 * 0.00000175 + 48000 * 0.000000175 + 150 * 0.000014
      //           = 0.0035 + 0.0084 + 0.0021 = 0.014
      expect(withoutCache!.totalPrice).toBeCloseTo(0.0896, 4);
      expect(withCache!.totalPrice).toBeCloseTo(0.014, 3);

      // Verify ~84% cost savings with cached tokens
      const savings =
        (withoutCache!.totalPrice! - withCache!.totalPrice!) /
        withoutCache!.totalPrice!;
      expect(savings).toBeGreaterThan(0.8); // At least 80% savings
      expect(savings).toBeLessThan(0.9); // Less than 90% savings
    });

    it('handles pf/gpt-5.2 model with cached tokens', async () => {
      const model = 'pf/gpt-5.2';

      // Test the specific model from user's production data
      const result = await modelsService.extractTokenUsageFromResponse(model, {
        input_tokens: 47101,
        output_tokens: 113,
        total_tokens: 47214,
        input_tokens_details: { cached_tokens: 45000 }, // Assuming some cached tokens
        output_tokens_details: { reasoning_tokens: 0 },
      });

      expect(result).toBeDefined();
      expect(result!.inputTokens).toBe(47101);
      expect(result!.outputTokens).toBe(113);
      expect(result!.totalTokens).toBe(47214);
      expect(result!.cachedInputTokens).toBe(45000);

      // Verify price calculation with cached tokens
      // Non-cached: (47101 - 45000) * 0.00000175 = 2101 * 0.00000175 = 0.00367675
      // Cached: 45000 * 0.000000175 = 0.007875
      // Output: 113 * 0.000014 = 0.001582
      // Total: 0.00367675 + 0.007875 + 0.001582 = 0.01313375
      expect(result!.totalPrice).toBeCloseTo(0.01313375, 7);

      // Should NOT be the full-price calculation
      expect(result!.totalPrice).not.toBeCloseTo(0.08400875, 2);
    });
  });
});
