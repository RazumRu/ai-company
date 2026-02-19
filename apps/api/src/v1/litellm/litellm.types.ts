import { ResponseUsage } from 'openai/resources/responses/responses';

/**
 * Token usage for an entire LLM request.
 * This represents the full token consumption and cost for a complete API call.
 */
export type RequestTokenUsage = {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  totalPrice?: number;
  /**
   * Current context size (in tokens) for this thread/node snapshot.
   * This is not additive; it's a point-in-time measurement.
   */
  currentContext?: number;
  /**
   * Wall-clock duration of the LLM API call in milliseconds.
   * Measured client-side around the invoke() call.
   */
  durationMs?: number;
};

export type UsageMetadata = Partial<ResponseUsage> & {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_read?: number;
    audio_tokens?: number;
  };
  input_token_details?: {
    cached_tokens?: number;
    cache_read?: number;
  };
  input_tokens_details?: {
    cached_tokens?: number;
    cache_read?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    reasoning?: number;
    audio_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
    reasoning?: number;
  };
  /**
   * Provider-reported cost (e.g. OpenRouter `usage.cost`).
   * Used as a fallback when per-token model rates are unavailable.
   */
  cost?: number;
};

/**
 * Token usage for a specific message.
 * This is the proportional share of tokens and cost attributed to a single message.
 * Used by LiteLLM service for message-level token counting.
 */
export type MessageTokenUsage = {
  totalTokens: number;
  totalPrice?: number;
};

export type LLMTokenCostRates = {
  inputCostPerToken: number;
  outputCostPerToken: number;
  inputCostPerCachedToken?: number;
  outputCostPerReasoningToken?: number;
};

export type LiteLLMModelInfo = {
  model_name: string;
  litellm_params: {
    model: string;
    [key: string]: unknown;
  };
  model_info: {
    key: string;
    litellm_provider?: string;
    input_cost_per_token?: number;
    input_cost_per_token_cache_hit?: number;
    cache_read_input_token_cost?: number;
    output_cost_per_token?: number;
    output_cost_per_reasoning_token?: number;
    supports_response_schema?: boolean;
    supports_reasoning?: boolean;
    supports_function_calling?: boolean;
    supports_parallel_function_calling?: boolean;
    supports_native_streaming?: boolean;
    supports_assistant_prefill?: boolean;
  } | null;
};
