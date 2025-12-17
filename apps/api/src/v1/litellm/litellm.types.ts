export type TokenUsage = {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  reasoningTokens?: number;
  totalTokens: number;
  totalPrice?: number;
};

// Per-message token usage stored on MessageEntity / message DTOs
export type MessageTokenUsage = {
  totalTokens: number;
  totalPrice?: number;
};
