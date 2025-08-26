import { Module } from '@nestjs/common';

import { AgentsModule } from './v1/agents/agents.module';
import { OpenaiModule } from './v1/openai/openai.module';
import { RuntimeModule } from './v1/runtime/runtime.module';

@Module({
  imports: [RuntimeModule, OpenaiModule, AgentsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
