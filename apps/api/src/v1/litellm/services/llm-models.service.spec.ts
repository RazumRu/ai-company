import type { DefaultLogger } from '@packages/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserPreferencesService } from '../../user-preferences/services/user-preferences.service';
import type { ModelPreferences } from '../../user-preferences/user-preferences.types';
import type { LitellmService } from './litellm.service';
import { LlmModelsService } from './llm-models.service';

const ENV_DEFAULTS = vi.hoisted(() => ({
  llmLargeModel: 'env-large',
  llmLargeCodeModel: 'env-large-code',
  llmMiniCodeModel: 'env-mini-code',
  llmMiniModel: 'env-mini',
  llmEmbeddingModel: 'env-embedding',
  llmCodeExplorerSubagentModel: '',
  llmUseOfflineModel: false,
  llmOfflineCodingModel: 'offline-coding',
  llmOfflineCodingMiniModel: 'offline-coding-mini',
  llmOfflineEmbeddingModel: 'offline-embedding',
  llmOfflineMiniModel: 'offline-mini',
  llmSummarizeOnlineThreshold: 30000,
}));

vi.mock('../../../environments', () => ({
  environment: ENV_DEFAULTS,
}));

const createMockUserPreferencesService = (
  overrides?: Partial<ModelPreferences> | null,
  shouldThrow = false,
) => {
  const getModelOverridesForUser = shouldThrow
    ? vi.fn().mockRejectedValue(new Error('DB connection failed'))
    : vi
        .fn()
        .mockResolvedValue(overrides === null ? null : (overrides ?? null));

  return { getModelOverridesForUser } as unknown as UserPreferencesService;
};

const createMockLitellmService = () => {
  return {
    supportsReasoning: vi.fn().mockResolvedValue(false),
  } as unknown as LitellmService;
};

const createMockLogger = () => ({
  log: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
});

const createService = (
  userPrefsOverrides?: Partial<ModelPreferences> | null,
  shouldThrow = false,
) => {
  const userPreferencesService = createMockUserPreferencesService(
    userPrefsOverrides,
    shouldThrow,
  );
  const litellmService = createMockLitellmService();
  const logger = createMockLogger();

  return {
    service: new LlmModelsService(
      litellmService,
      userPreferencesService,
      logger as unknown as DefaultLogger,
    ),
    userPreferencesService,
    logger,
  };
};

describe('LlmModelsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ENV_DEFAULTS.llmUseOfflineModel = false;
    ENV_DEFAULTS.llmCodeExplorerSubagentModel = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildLLMRequestContext', () => {
    it('returns empty models when no userId and no project settings', async () => {
      const { service } = createService();

      const ctx = await service.buildLLMRequestContext();

      expect(ctx).toEqual({ models: undefined });
    });

    it('returns user model overrides when userId is provided', async () => {
      const { service } = createService({
        llmLargeCodeModel: 'user-large-code',
      });

      const ctx = await service.buildLLMRequestContext('user-1');

      expect(ctx).toEqual({
        models: { llmLargeCodeModel: 'user-large-code' },
      });
    });

    it('returns project overrides merged over user overrides', async () => {
      const { service } = createService({
        llmLargeCodeModel: 'user-large-code',
        llmMiniModel: 'user-mini',
      });

      const ctx = await service.buildLLMRequestContext('user-1', {
        models: {
          llmLargeCodeModel: 'project-large-code',
        } satisfies ModelPreferences,
      });

      expect(ctx.models).toEqual({
        llmLargeCodeModel: 'project-large-code',
        llmMiniModel: 'user-mini',
      });
    });

    it('falls back gracefully when userPreferencesService throws', async () => {
      const { service, logger } = createService(undefined, true);

      const ctx = await service.buildLLMRequestContext('user-1');

      expect(ctx).toEqual({ models: undefined });
      expect(logger.error).toHaveBeenCalledOnce();
    });
  });

  describe('model resolution (model?: string)', () => {
    it('returns provided model when given', () => {
      const { service } = createService();

      const result = service.getLargeCodeModel('custom-model');

      expect(result).toBe('custom-model');
    });

    it('returns env default when model is undefined', () => {
      const { service } = createService();

      const result = service.getLargeCodeModel();

      expect(result).toBe('env-large-code');
    });

    it('returns env default when model is undefined for getAiSuggestionsDefaultModel', () => {
      const { service } = createService();

      const result = service.getAiSuggestionsDefaultModel();

      expect(result).toBe('env-large');
    });

    it('returns provided model for getAiSuggestionsDefaultModel', () => {
      const { service } = createService();

      const result = service.getAiSuggestionsDefaultModel('custom-large');

      expect(result).toBe('custom-large');
    });

    it('returns env default for getThreadNameModel without override', () => {
      const { service } = createService();

      const result = service.getThreadNameModel();

      expect(result).toBe('env-mini');
    });

    it('returns provided model for getThreadNameModel', () => {
      const { service } = createService();

      const result = service.getThreadNameModel('custom-mini');

      expect(result).toBe('custom-mini');
    });

    it('returns env default for getKnowledgeEmbeddingModel without override', () => {
      const { service } = createService();

      const result = service.getKnowledgeEmbeddingModel();

      expect(result).toBe('env-embedding');
    });

    it('returns provided model for getKnowledgeEmbeddingModel', () => {
      const { service } = createService();

      const result = service.getKnowledgeEmbeddingModel('custom-embedding');

      expect(result).toBe('custom-embedding');
    });

    it('returns env default for getKnowledgeSearchModel without override', () => {
      const { service } = createService();

      const result = service.getKnowledgeSearchModel();

      expect(result).toBe('env-mini');
    });

    it('returns provided model for getSubagentFastModel', () => {
      const { service } = createService();

      const result = service.getSubagentFastModel('custom-fast');

      expect(result).toBe('custom-fast');
    });

    it('returns env default for getSubagentFastModel without override', () => {
      const { service } = createService();

      const result = service.getSubagentFastModel();

      expect(result).toBe('env-mini-code');
    });

    it('returns env default for getSubagentExplorerModel when no explorer model set', () => {
      const { service } = createService();

      const result = service.getSubagentExplorerModel();

      // llmCodeExplorerSubagentModel is '' so falls back to llmMiniCodeModel
      expect(result).toBe('env-mini-code');
    });

    it('returns explorer model from env when set', () => {
      ENV_DEFAULTS.llmCodeExplorerSubagentModel = 'env-explorer';
      const { service } = createService();

      const result = service.getSubagentExplorerModel();

      expect(result).toBe('env-explorer');
    });

    it('returns provided model for getSubagentExplorerModel', () => {
      const { service } = createService();

      const result = service.getSubagentExplorerModel('custom-explorer');

      expect(result).toBe('custom-explorer');
    });

    it('does not call userPreferencesService for sync model resolution', () => {
      const { service, userPreferencesService } = createService({
        llmLargeModel: 'user-large',
      });

      const result = service.getAiSuggestionsDefaultModel();

      expect(result).toBe('env-large');
      expect(
        userPreferencesService.getModelOverridesForUser,
      ).not.toHaveBeenCalled();
    });
  });

  describe('getSummarizeModel', () => {
    it('returns provided model when given', () => {
      const { service } = createService();

      const result = service.getSummarizeModel(undefined, 'custom-mini');

      expect(result).toBe('custom-mini');
    });

    it('returns env default when no model provided', () => {
      const { service } = createService();

      const result = service.getSummarizeModel();

      expect(result).toBe('env-mini');
    });

    it('forces online model when offline mode is active and context exceeds threshold', () => {
      ENV_DEFAULTS.llmUseOfflineModel = true;
      const { service } = createService();

      const result = service.getSummarizeModel(40000);

      expect(result).toBe('env-mini');
    });

    it('returns provided model override even in offline+large-context scenario', () => {
      ENV_DEFAULTS.llmUseOfflineModel = true;
      const { service } = createService();

      const result = service.getSummarizeModel(40000, 'user-mini');

      expect(result).toBe('user-mini');
    });

    it('returns offline mini model when offline mode is active and context is within threshold', () => {
      ENV_DEFAULTS.llmUseOfflineModel = true;
      const { service } = createService();

      const result = service.getSummarizeModel(10000);

      expect(result).toBe('offline-mini');
    });
  });
});
