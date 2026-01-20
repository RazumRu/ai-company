import { Module } from '@nestjs/common';

import { ModelsController } from './controllers/models.controller';
import { LiteLlmClient } from './services/litellm.client';
import { LitellmService } from './services/litellm.service';
import { LlmModelsService } from './services/llm-models.service';

@Module({
  controllers: [ModelsController],
  providers: [LiteLlmClient, LitellmService, LlmModelsService],
  exports: [LitellmService, LlmModelsService],
})
export class LitellmModule {}
