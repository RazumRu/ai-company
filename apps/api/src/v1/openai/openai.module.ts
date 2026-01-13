import { Module } from '@nestjs/common';

import { LitellmModule } from '../litellm/litellm.module';
import { OpenaiService } from './openai.service';

@Module({
  imports: [LitellmModule],
  controllers: [],
  providers: [OpenaiService],
  exports: [OpenaiService],
})
export class OpenaiModule {}
