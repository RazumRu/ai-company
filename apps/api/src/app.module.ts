import { Module } from '@nestjs/common';

import { AgentsModule } from './v1/agents/agents.module';
import { GraphTemplatesModule } from './v1/graph-templates/graph-templates.module';
import { GraphsModule } from './v1/graphs/graphs.module';
import { RuntimeModule } from './v1/runtime/runtime.module';

@Module({
  imports: [RuntimeModule, AgentsModule, GraphsModule, GraphTemplatesModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
