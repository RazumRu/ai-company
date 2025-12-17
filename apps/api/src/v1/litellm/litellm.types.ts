export type TokenUsage = {
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

// Per-message token usage stored on MessageEntity / message DTOs
export type MessageTokenUsage = {
  totalTokens: number;
  totalPrice?: number;
};
