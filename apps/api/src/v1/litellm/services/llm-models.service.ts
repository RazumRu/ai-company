import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { environment } from '../../../environments';
import type { LLMRequestContext } from '../../agents/agents.types';
import { UserPreferencesService } from '../../user-preferences/services/user-preferences.service';
import type { ModelPreferences } from '../../user-preferences/user-preferences.types';
import { LitellmService } from './litellm.service';

@Injectable()
export class LlmModelsService {
  private static readonly DEFAULT_REASONING = {
    low: { effort: 'low' as const },
    medium: { effort: 'medium' as const },
    high: { effort: 'high' as const },
  };

  constructor(
    private readonly litellmService: LitellmService,
    private readonly userPreferencesService: UserPreferencesService,
    private readonly logger: DefaultLogger,
  ) {}

  /**
   * Builds a pre-resolved LLMRequestContext by fetching user preferences
   * and merging with project settings. Call this ONCE per request, then pass
   * the result to sync model-resolution methods.
   *
   * Priority: project-level overrides > user-level overrides > env defaults.
   */
  async buildLLMRequestContext(
    userId?: string,
    projectSettings?: Record<string, unknown>,
  ): Promise<LLMRequestContext> {
    let models: ModelPreferences = {};

    // User-level overrides (lower priority)
    if (userId) {
      try {
        const userModels =
          await this.userPreferencesService.getModelOverridesForUser(userId);
        if (userModels) {
          models = { ...userModels };
        }
      } catch (err) {
        this.logger.error(
          err instanceof Error ? err : new Error(String(err)),
          'Failed to resolve user model overrides',
        );
      }
    }

    // Project-level overrides (higher priority — overwrites user)
    const projectModels = projectSettings?.['models'] as
      | ModelPreferences
      | undefined;
    if (projectModels) {
      for (const [key, value] of Object.entries(projectModels)) {
        if (value != null) {
          (models as Record<string, string>)[key] = value;
        }
      }
    }

    return {
      models: Object.keys(models).length > 0 ? models : undefined,
    };
  }

  private async buildResponseParams(
    model: string,
    reasoning?: (typeof LlmModelsService.DEFAULT_REASONING)[keyof typeof LlmModelsService.DEFAULT_REASONING],
  ): Promise<{
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  }> {
    if (!reasoning) {
      return { model };
    }
    const supportsReasoning =
      await this.litellmService.supportsReasoning(model);
    if (!supportsReasoning) {
      return { model };
    }
    return { model, reasoning };
  }

  getSummarizeModel(model?: string): string {
    return model ?? environment.llmMiniModel;
  }

  getAiSuggestionsDefaultModel(model?: string): string {
    return model ?? environment.llmLargeModel;
  }

  getThreadNameModel(model?: string): string {
    return model ?? environment.llmMiniModel;
  }

  async getKnowledgeMetadataParams(model?: string): Promise<{
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  }> {
    const resolvedModel = model ?? environment.llmMiniModel;
    return this.buildResponseParams(
      resolvedModel,
      LlmModelsService.DEFAULT_REASONING.medium,
    );
  }

  getKnowledgeEmbeddingModel(model?: string): string {
    return model ?? environment.llmEmbeddingModel;
  }

  getKnowledgeSearchModel(model?: string): string {
    return model ?? environment.llmMiniModel;
  }

  getSubagentFastModel(model?: string): string {
    return model ?? environment.llmMiniCodeModel;
  }

  /**
   * Returns the model used by the explorer subagent.
   * Falls back to the explorer-specific env var, then the mini code model.
   */
  getSubagentExplorerModel(model?: string): string {
    return (
      model ??
      (environment.llmCodeExplorerSubagentModel || environment.llmMiniCodeModel)
    );
  }

  getLargeCodeModel(model?: string): string {
    return model ?? environment.llmLargeCodeModel;
  }

  getModelDefaults(): {
    llmLargeModel: string;
    llmLargeCodeModel: string;
    llmMiniCodeModel: string;
    llmCodeExplorerSubagentModel: string;
    llmMiniModel: string;
    llmEmbeddingModel: string;
  } {
    return {
      llmLargeModel: environment.llmLargeModel,
      llmLargeCodeModel: environment.llmLargeCodeModel,
      llmMiniCodeModel: environment.llmMiniCodeModel,
      llmCodeExplorerSubagentModel:
        environment.llmCodeExplorerSubagentModel ||
        environment.llmMiniCodeModel,
      llmMiniModel: environment.llmMiniModel,
      llmEmbeddingModel: environment.llmEmbeddingModel,
    };
  }
}
