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
};

export type UsageMetadata = Partial<ResponseUsage> & {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_read?: number;
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
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
    reasoning?: number;
  };
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
