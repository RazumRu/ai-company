import { Module } from '@nestjs/common';

import { GraphTemplatesModule } from '../graph-templates/graph-templates.module';
import { GraphsModule } from '../graphs/graphs.module';
import { OpenaiModule } from '../openai/openai.module';
import { ThreadsModule } from '../threads/threads.module';
import { AiSuggestionsController } from './controllers/ai-suggestions.controller';
import { AiSuggestionsService } from './services/ai-suggestions.service';

@Module({
  imports: [GraphsModule, ThreadsModule, GraphTemplatesModule, OpenaiModule],
  controllers: [AiSuggestionsController],
  providers: [AiSuggestionsService],
  exports: [AiSuggestionsService],
})
export class AiSuggestionsModule {}
