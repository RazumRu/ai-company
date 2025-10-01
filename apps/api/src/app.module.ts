import { Module } from '@nestjs/common';

import { AgentsModule } from './v1/agents/agents.module';
import { GraphsModule } from './v1/graphs/graphs.module';
import { RuntimeModule } from './v1/runtime/runtime.module';

@Module({
  imports: [RuntimeModule, AgentsModule, GraphsModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
