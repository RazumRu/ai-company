import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { LitellmModule } from '../litellm/litellm.module';
import { OpenaiModule } from '../openai/openai.module';
import { QdrantModule } from '../qdrant/qdrant.module';
import { KnowledgeController } from './controllers/knowledge.controller';
import { KnowledgeDocDao } from './dao/knowledge-doc.dao';
import { KnowledgeDocEntity } from './entity/knowledge-doc.entity';
import { KnowledgeService } from './services/knowledge.service';
import { KnowledgeChunksService } from './services/knowledge-chunks.service';

@Module({
  imports: [
    registerEntities([KnowledgeDocEntity]),
    OpenaiModule,
    LitellmModule,
    QdrantModule,
  ],
  controllers: [KnowledgeController],
  providers: [KnowledgeDocDao, KnowledgeChunksService, KnowledgeService],
  exports: [KnowledgeService, KnowledgeDocDao, KnowledgeChunksService],
})
export class KnowledgeModule {}
