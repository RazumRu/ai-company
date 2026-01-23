import { Injectable } from '@nestjs/common';

import { environment } from '../../../environments';

@Injectable()
export class LlmModelsService {
  private static readonly DEFAULT_REASONING = {
    low: { effort: 'low' as const },
    medium: { effort: 'medium' as const },
    high: { effort: 'high' as const },
  };

  private isOfflineModel(model: string): boolean {
    return (
      environment.llmUseOfflineModel && model === environment.llmOfflineModel
    );
  }

  private offlineFallback(model: string): string {
    return environment.llmUseOfflineModel ? environment.llmOfflineModel : model;
  }

  private buildResponseParams(
    model: string,
    reasoning?: (typeof LlmModelsService.DEFAULT_REASONING)[keyof typeof LlmModelsService.DEFAULT_REASONING],
  ): { model: string; reasoning?: { effort: 'low' | 'medium' | 'high' } } {
    const resolvedModel = this.offlineFallback(model);
    if (!reasoning || this.isOfflineModel(resolvedModel)) {
      return { model: resolvedModel };
    }
    return { model: resolvedModel, reasoning };
  }

  getSummarizeModel(): string {
    return this.offlineFallback(environment.llmMiniModel);
  }

  getFilesEditModel(smart: boolean): string {
    return smart
      ? environment.llmLargeCodeModel
      : this.offlineFallback(environment.llmMiniCodeModel);
  }

  getAiSuggestionsModel(): string {
    return environment.llmLargeModel;
  }

  getThreadNameModel(): string {
    return this.offlineFallback(environment.llmMiniModel);
  }

  getThreadNameParams(): {
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  } {
    return this.buildResponseParams(environment.llmMiniModel);
  }

  getFilesEditParams(smart: boolean): {
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  } {
    const model = smart
      ? environment.llmLargeCodeModel
      : environment.llmMiniCodeModel;
    return this.buildResponseParams(
      model,
      LlmModelsService.DEFAULT_REASONING.low,
    );
  }

  getKnowledgeMetadataModel(): string {
    return this.offlineFallback(environment.llmMiniModel);
  }

  getKnowledgeMetadataParams(): {
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  } {
    return this.buildResponseParams(
      environment.llmMiniModel,
      LlmModelsService.DEFAULT_REASONING.medium,
    );
  }

  getKnowledgeChunkingModel(): string {
    return this.offlineFallback(environment.llmMiniModel);
  }

  getKnowledgeChunkingParams(): {
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  } {
    return this.buildResponseParams(
      environment.llmMiniModel,
      LlmModelsService.DEFAULT_REASONING.low,
    );
  }

  getKnowledgeEmbeddingModel(): string {
    return environment.llmEmbeddingModel;
  }

  getKnowledgeSearchModel(): string {
    return this.offlineFallback(environment.llmMiniModel);
  }

  getKnowledgeSearchParams(): {
    model: string;
    reasoning?: { effort: 'low' | 'medium' | 'high' };
  } {
    return this.buildResponseParams(
      environment.llmMiniModel,
      LlmModelsService.DEFAULT_REASONING.low,
    );
  }
}
