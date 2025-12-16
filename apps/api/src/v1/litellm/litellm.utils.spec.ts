import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('llm-cost', () => ({
  estimateCost: vi.fn(),
}));

import { estimateCost } from 'llm-cost';

import {
  extractTokenUsageFromAdditionalKwargs,
  extractTokenUsageFromResponse,
} from './litellm.utils';

describe('extractTokenUsageFromResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when usage_metadata is missing or not an object', () => {
    expect(
      extractTokenUsageFromResponse({
        usage_metadata: undefined,
        response_metadata: {},
        model: 'gpt-4o-mini',
      }),
    ).toBeNull();

    expect(
      extractTokenUsageFromResponse({
        usage_metadata: 'not-an-object',
        response_metadata: {},
        model: 'gpt-4o-mini',
      }),
    ).toBeNull();
  });

  it('extracts token usage fields and prefers usage_metadata.total_tokens', () => {
    (estimateCost as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      0.0123,
    );

    const result = extractTokenUsageFromResponse({
      usage_metadata: {
        input_tokens: 10,
        output_tokens: 5,
        total_tokens: 20,
        input_tokens_details: { cached_tokens: 3 },
        output_tokens_details: { reasoning_tokens: 2 },
      },
      response_metadata: {},
      model: 'gpt-4o-mini',
    });

    expect(result).toEqual({
      inputTokens: 10,
      cachedInputTokens: 3,
      outputTokens: 5,
      reasoningTokens: 2,
      totalTokens: 20,
      totalPrice: 0.0123,
    });

    expect(estimateCost).toHaveBeenCalledWith({
      model: 'gpt-4o-mini',
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it('falls back to response_metadata.response_cost when estimateCost is not a finite number', () => {
    (estimateCost as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      Number.NaN,
    );

    const result = extractTokenUsageFromResponse({
      usage_metadata: {
        input_tokens: 1,
        output_tokens: 2,
        total_tokens: 3,
      },
      response_metadata: {
        response_cost: 0.9,
      },
      model: 'some-unknown-model',
    });

    expect(result).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3,
      totalPrice: 0.9,
    });
  });

  it('falls back to response_metadata._hidden_params.response_cost when response_cost is absent', () => {
    (estimateCost as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      undefined,
    );

    const result = extractTokenUsageFromResponse({
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
      model: '',
    });

    expect(result).toEqual({
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
      totalPrice: 1.23,
    });
  });

  it('omits totalPrice when it cannot be determined', () => {
    (estimateCost as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      undefined,
    );

    const result = extractTokenUsageFromResponse({
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
      model: '',
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
    expect(
      extractTokenUsageFromAdditionalKwargs({
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
    expect(extractTokenUsageFromAdditionalKwargs(undefined)).toBeNull();
    expect(extractTokenUsageFromAdditionalKwargs({})).toBeNull();
    expect(
      extractTokenUsageFromAdditionalKwargs({ tokenUsage: 'nope' }),
    ).toBeNull();
    expect(
      extractTokenUsageFromAdditionalKwargs({
        tokenUsage: { inputTokens: 1, outputTokens: 2 }, // missing totalTokens
      }),
    ).toBeNull();
  });

  it('accepts an array and returns aggregated totals', () => {
    expect(
      extractTokenUsageFromAdditionalKwargs([
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
    expect(
      extractTokenUsageFromAdditionalKwargs([undefined, null, {}]),
    ).toBeNull();
  });
});
