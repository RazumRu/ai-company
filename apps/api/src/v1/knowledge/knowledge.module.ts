import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { LitellmModule } from '../litellm/litellm.module';
import { OpenaiModule } from '../openai/openai.module';
import { KnowledgeController } from './controllers/knowledge.controller';
import { KnowledgeChunkDao } from './dao/knowledge-chunk.dao';
import { KnowledgeDocDao } from './dao/knowledge-doc.dao';
import { KnowledgeChunkEntity } from './entity/knowledge-chunk.entity';
import { KnowledgeDocEntity } from './entity/knowledge-doc.entity';
import { KnowledgeService } from './services/knowledge.service';

@Module({
  imports: [
    registerEntities([KnowledgeDocEntity, KnowledgeChunkEntity]),
    OpenaiModule,
    LitellmModule,
  ],
  controllers: [KnowledgeController],
  providers: [KnowledgeDocDao, KnowledgeChunkDao, KnowledgeService],
  exports: [KnowledgeService, KnowledgeDocDao, KnowledgeChunkDao],
})
export class KnowledgeModule {}
