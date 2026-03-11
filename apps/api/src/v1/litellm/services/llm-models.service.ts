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

  private offlineCodingFallback(model: string): string {
    return environment.llmUseOfflineModel
      ? environment.llmOfflineCodingModel
      : model;
  }

  private offlineEmbeddingFallback(model: string): string {
    return environment.llmUseOfflineModel
      ? environment.llmOfflineEmbeddingModel
      : model;
  }

  private offlineMiniFallback(model: string): string {
    return environment.llmUseOfflineModel
      ? environment.llmOfflineMiniModel
      : model;
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

  /**
   * Returns the model to use for summarization based on the current context size.
   * When offline mode is active and the context exceeds the online threshold,
   * forces the online model to ensure quality summarization of large conversations.
   *
   * @param currentContext - Current token count of the conversation. When above
   *   the threshold (LLM_SUMMARIZE_ONLINE_THRESHOLD, default 30000), the online
   *   model is used regardless of the offline mode setting.
   * @param model - Optional model override from LLMRequestContext.
   */
  getSummarizeModel(currentContext?: number, model?: string): string {
    if (
      environment.llmUseOfflineModel &&
      currentContext !== undefined &&
      currentContext > environment.llmSummarizeOnlineThreshold
    ) {
      return model ?? environment.llmMiniModel;
    }
    return model ?? this.offlineMiniFallback(environment.llmMiniModel);
  }

  getAiSuggestionsDefaultModel(model?: string): string {
    return model ?? environment.llmLargeModel;
  }

  getThreadNameModel(model?: string): string {
    return model ?? this.offlineMiniFallback(environment.llmMiniModel);
  }

  async getKnowledgeMetadataParams(model?: string): Promise<{
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  }> {
    const resolvedModel =
      model ?? this.offlineMiniFallback(environment.llmMiniModel);
    return this.buildResponseParams(
      resolvedModel,
      LlmModelsService.DEFAULT_REASONING.medium,
    );
  }

  getKnowledgeEmbeddingModel(model?: string): string {
    return (
      model ?? this.offlineEmbeddingFallback(environment.llmEmbeddingModel)
    );
  }

  getKnowledgeSearchModel(model?: string): string {
    return model ?? this.offlineMiniFallback(environment.llmMiniModel);
  }

  getSubagentFastModel(model?: string): string {
    return model ?? this.offlineCodingFallback(environment.llmMiniCodeModel);
  }

  /**
   * Returns the model used by the explorer subagent.
   * Always uses the online mini model -- explorer subagents need hosted-quality
   * responses even when the main agent is in offline mode.
   */
  getSubagentExplorerModel(model?: string): string {
    return (
      model ??
      (environment.llmCodeExplorerSubagentModel || environment.llmMiniCodeModel)
    );
  }

  getLargeCodeModel(model?: string): string {
    return model ?? this.offlineCodingFallback(environment.llmLargeCodeModel);
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
