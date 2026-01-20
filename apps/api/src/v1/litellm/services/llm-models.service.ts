import { Injectable } from '@nestjs/common';

import { environment } from '../../../environments';

@Injectable()
export class LlmModelsService {
  getSummarizeEditModel(): string {
    return environment.llmMiniModel;
  }

  getFilesEditModel(smart: boolean): string {
    return smart ? environment.llmLargeCodeModel : environment.llmMiniCodeModel;
  }

  getAiSuggestionsModel(): string {
    return environment.llmLargeModel;
  }

  getThreadNameModel(): string {
    return environment.llmMiniModel;
  }

  getKnowledgeMetadataModel(): string {
    return environment.llmMiniModel;
  }

  getKnowledgeChunkingModel(): string {
    return environment.llmMiniModel;
  }

  getKnowledgeEmbeddingModel(): string {
    return environment.llmEmbeddingModel;
  }
}
