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

/**
 * Token usage for a specific message.
 * This is the proportional share of tokens and cost attributed to a single message.
 * Used by LiteLLM service for message-level token counting.
 */
export type MessageTokenUsage = {
  totalTokens: number;
  totalPrice?: number;
};
