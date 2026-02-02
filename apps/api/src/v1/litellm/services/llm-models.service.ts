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

  private offlineGeneralFallback(model: string): string {
    return environment.llmUseOfflineModel
      ? environment.llmOfflineGeneralModel
      : model;
  }

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

  getSummarizeModel(): string {
    return this.offlineMiniFallback(environment.llmMiniModel);
  }

  getAiSuggestionsDefaultModel(): string {
    return environment.llmLargeModel;
  }

  getThreadNameModel(): string {
    return this.offlineMiniFallback(environment.llmMiniModel);
  }

  async getFilesEditParams(smart: boolean): Promise<{
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  }> {
    const model = smart
      ? this.offlineCodingFallback(environment.llmLargeCodeModel)
      : this.offlineCodingMiniFallback(environment.llmMiniCodeModel);

    return this.buildResponseParams(
      model,
      LlmModelsService.DEFAULT_REASONING.medium,
    );
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
}
