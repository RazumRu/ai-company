import { Injectable } from '@nestjs/common';

import { environment } from '../../../environments';
import { LitellmService } from './litellm.service';

@Injectable()
export class LlmModelsService {
  private static readonly DEFAULT_REASONING = {
    low: { effort: 'low' as const },
    medium: { effort: 'medium' as const },
    high: { effort: 'high' as const },
  };

  constructor(private readonly litellmService: LitellmService) {}

  private offlineCodingFallback(model: string): string {
    return environment.llmUseOfflineModel
      ? environment.llmOfflineCodingModel
      : model;
  }

  private offlineCodingMiniFallback(model: string): string {
    return environment.llmUseOfflineModel
      ? environment.llmOfflineCodingMiniModel
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
   */
  getSummarizeModel(currentContext?: number): string {
    if (
      environment.llmUseOfflineModel &&
      currentContext !== undefined &&
      currentContext > environment.llmSummarizeOnlineThreshold
    ) {
      return environment.llmMiniModel;
    }
    return this.offlineMiniFallback(environment.llmMiniModel);
  }

  getAiSuggestionsDefaultModel(): string {
    return environment.llmLargeModel;
  }

  getThreadNameModel(): string {
    return this.offlineMiniFallback(environment.llmMiniModel);
  }

  async getKnowledgeMetadataParams(): Promise<{
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  }> {
    return this.buildResponseParams(
      this.offlineMiniFallback(environment.llmMiniModel),
      LlmModelsService.DEFAULT_REASONING.medium,
    );
  }

  getKnowledgeEmbeddingModel(): string {
    return this.offlineEmbeddingFallback(environment.llmEmbeddingModel);
  }

  getKnowledgeSearchModel(): string {
    return this.offlineMiniFallback(environment.llmMiniModel);
  }

  getSubagentFastModel(): string {
    return this.offlineCodingFallback(environment.llmMiniCodeModel);
  }

  /**
   * Returns the model used by the explorer subagent.
   * Always uses the online mini model — explorer subagents need hosted-quality
   * responses even when the main agent is in offline mode.
   */
  getSubagentExplorerModel(): string {
    return environment.llmSubagentExplorerModel;
  }
}
