import { Module } from '@nestjs/common';

import { ModelsController } from './controllers/models.controller';
import { LiteLlmClient } from './services/litellm.client';
import { LitellmService } from './services/litellm.service';

@Module({
  controllers: [ModelsController],
  providers: [LiteLlmClient, LitellmService],
  exports: [LitellmService],
})
export class LitellmModule {}

