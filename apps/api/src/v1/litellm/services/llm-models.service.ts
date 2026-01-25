import { Injectable } from '@nestjs/common';

import { environment } from '../../../environments';

@Injectable()
export class LlmModelsService {
  private static readonly DEFAULT_REASONING = {
    low: { effort: 'low' as const },
    medium: { effort: 'medium' as const },
    high: { effort: 'high' as const },
  };

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

  private offlineEmbeddingFallback(model: string): string {
    return environment.llmUseOfflineModel
      ? environment.llmOfflineEmbeddingModel
      : model;
  }

  private buildResponseParams(
    model: string,
    reasoning?: (typeof LlmModelsService.DEFAULT_REASONING)[keyof typeof LlmModelsService.DEFAULT_REASONING],
  ): { model: string; reasoning?: { effort: 'low' | 'medium' | 'high' } } {
    if (
      !reasoning ||
      this.isModelInList(model, environment.llmNoReasoningModels)
    ) {
      return { model };
    }
    return { model, reasoning };
  }

  private isModelInList(model: string, list: string): boolean {
    if (!model) {
      return false;
    }

    const entries = list
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (!entries.length) {
      return false;
    }

    const normalized = model.toLowerCase();
    if (entries.includes(normalized)) {
      return true;
    }

    const normalizedShort = normalized.includes('/')
      ? normalized.split('/').pop()
      : normalized;
    return entries.some((entry) => {
      const entryShort = entry.includes('/') ? entry.split('/').pop() : entry;
      return normalizedShort === entryShort;
    });
  }

  getSummarizeModel(): string {
    return this.offlineGeneralFallback(environment.llmMiniModel);
  }

  getAiSuggestionsDefaultModel(): string {
    return environment.llmLargeModel;
  }

  getThreadNameModel(): string {
    return this.offlineGeneralFallback(environment.llmMiniModel);
  }

  getFilesEditParams(smart: boolean): {
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  } {
    const model = smart
      ? environment.llmLargeCodeModel
      : environment.llmMiniCodeModel;

    return this.buildResponseParams(
      this.offlineCodingFallback(model),
      LlmModelsService.DEFAULT_REASONING.medium,
    );
  }

  getKnowledgeMetadataParams(): {
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  } {
    return this.buildResponseParams(
      this.offlineGeneralFallback(environment.llmMiniModel),
      LlmModelsService.DEFAULT_REASONING.medium,
    );
  }

  getKnowledgeEmbeddingModel(): string {
    return this.offlineEmbeddingFallback(environment.llmEmbeddingModel);
  }

  getKnowledgeSearchModel(): string {
    return this.offlineGeneralFallback(environment.llmMiniModel);
  }
}
