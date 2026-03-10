export type ModelPreferences = {
  llmLargeModel?: string;
  llmLargeCodeModel?: string;
  llmMiniCodeModel?: string;
  llmCodeExplorerSubagentModel?: string;
  llmMiniModel?: string;
  llmEmbeddingModel?: string;
};

export type UserPreferencesPayload = {
  models?: ModelPreferences;
};
