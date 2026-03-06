import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { AgentsModule } from './v1/agents/agents.module';
import { AiSuggestionsModule } from './v1/ai-suggestions/ai-suggestions.module';
import { AnalyticsModule } from './v1/analytics/analytics.module';
import { CacheModule } from './v1/cache/cache.module';
import { GitAuthModule } from './v1/git-auth/git-auth.module';
import { GitRepositoriesModule } from './v1/git-repositories/git-repositories.module';
import { GraphTemplatesModule } from './v1/graph-templates/graph-templates.module';
import { GraphsModule } from './v1/graphs/graphs.module';
import { KnowledgeModule } from './v1/knowledge/knowledge.module';
import { LitellmModule } from './v1/litellm/litellm.module';
import { NotificationHandlersModule } from './v1/notification-handlers/notification-handlers.module';
import { ProjectsModule } from './v1/projects/projects.module';
import { RuntimeModule } from './v1/runtime/runtime.module';
import { SystemModule } from './v1/system/system.module';
import { ThreadsModule } from './v1/threads/threads.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    CacheModule,
    RuntimeModule,
    AgentsModule,
    AiSuggestionsModule,
    AnalyticsModule,
    GraphsModule,
    LitellmModule,
    KnowledgeModule,
    GraphTemplatesModule,
    GitAuthModule,
    GitRepositoriesModule,
    NotificationHandlersModule,
    ProjectsModule,
    SystemModule,
    ThreadsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
