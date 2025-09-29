import { Module } from '@nestjs/common';

import { AgentsModule } from './v1/agents/agents.module';
import { RuntimeModule } from './v1/runtime/runtime.module';

@Module({
  imports: [RuntimeModule, AgentsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
