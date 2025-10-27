import { Module } from '@nestjs/common';

import { AgentsModule } from './v1/agents/agents.module';
import { GraphTemplatesModule } from './v1/graph-templates/graph-templates.module';
import { GraphsModule } from './v1/graphs/graphs.module';
import { NotificationHandlersModule } from './v1/notification-handlers/notification-handlers.module';
import { RuntimeModule } from './v1/runtime/runtime.module';
import { ThreadsModule } from './v1/threads/threads.module';

@Module({
  imports: [
    RuntimeModule,
    AgentsModule,
    GraphsModule,
    GraphTemplatesModule,
    NotificationHandlersModule,
    ThreadsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
