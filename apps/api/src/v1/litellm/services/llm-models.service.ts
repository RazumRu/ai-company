import { Injectable } from '@nestjs/common';

import { environment } from '../../../environments';

@Injectable()
export class LlmModelsService {
  private offlineFallback(model: string): string {
    return environment.llmUseOfflineModel ? environment.llmOfflineModel : model;
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

  getKnowledgeMetadataModel(): string {
    return this.offlineFallback(environment.llmMiniModel);
  }

  getKnowledgeChunkingModel(): string {
    return this.offlineFallback(environment.llmMiniModel);
  }

  getKnowledgeEmbeddingModel(): string {
    return environment.llmEmbeddingModel;
  }

  getKnowledgeSearchModel(): string {
    return this.offlineFallback(environment.llmMiniModel);
  }
}
