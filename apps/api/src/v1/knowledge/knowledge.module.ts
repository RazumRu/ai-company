import { Module, OnModuleInit } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { environment } from '../../environments';
import { LitellmModule } from '../litellm/litellm.module';
import { OpenaiModule } from '../openai/openai.module';
import { QdrantModule } from '../qdrant/qdrant.module';
import { KnowledgeController } from './controllers/knowledge.controller';
import { KnowledgeDocDao } from './dao/knowledge-doc.dao';
import { KnowledgeDocEntity } from './entity/knowledge-doc.entity';
import { KnowledgeService } from './services/knowledge.service';
import { KnowledgeChunksService } from './services/knowledge-chunks.service';
import { KnowledgeReindexService } from './services/knowledge-reindex.service';

@Module({
  imports: [
    registerEntities([KnowledgeDocEntity]),
    OpenaiModule,
    LitellmModule,
    QdrantModule,
  ],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeDocDao,
    KnowledgeChunksService,
    KnowledgeReindexService,
    KnowledgeService,
  ],
  exports: [KnowledgeService, KnowledgeDocDao, KnowledgeChunksService],
})
export class KnowledgeModule implements OnModuleInit {
  constructor(private readonly reindexService: KnowledgeReindexService) {}

  onModuleInit(): void {
    if (!environment.knowledgeReindexOnStartup) {
      return;
    }
    void this.reindexService.reindexDocsWithEmbeddingModelMismatch();
  }
}
