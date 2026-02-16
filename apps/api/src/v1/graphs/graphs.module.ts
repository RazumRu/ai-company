import './graphs.exceptions';

import { forwardRef, Module, OnModuleInit } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { environment } from '../../environments';
import { AgentsModule } from '../agents/agents.module';
import { GraphTemplatesModule } from '../graph-templates/graph-templates.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ThreadsModule } from '../threads/threads.module';
import { GraphRevisionsController } from './controllers/graph-revisions.controller';
import { GraphsController } from './controllers/graphs.controller';
import { GraphDao } from './dao/graph.dao';
import { GraphRevisionDao } from './dao/graph-revision.dao';
import { GraphEntity } from './entity/graph.entity';
import { GraphRevisionEntity } from './entity/graph-revision.entity';
import { GraphAiPreviewService } from './services/graph-ai-preview.service';
import { GraphCompiler } from './services/graph-compiler';
import { GraphMergeService } from './services/graph-merge.service';
import { GraphRegistry } from './services/graph-registry';
import { GraphRestorationService } from './services/graph-restoration.service';
import { GraphRevisionService } from './services/graph-revision.service';
import { GraphRevisionQueueService } from './services/graph-revision-queue.service';
import { GraphStateFactory } from './services/graph-state.factory';
import { GraphStateManager } from './services/graph-state.manager';
import { GraphsService } from './services/graphs.service';
import { MessageTransformerService } from './services/message-transformer.service';

@Module({
  imports: [
    registerEntities([GraphEntity, GraphRevisionEntity]),
    forwardRef(() => GraphTemplatesModule),
    NotificationsModule,
    AgentsModule,
    ThreadsModule,
  ],
  controllers: [GraphsController, GraphRevisionsController],
  providers: [
    GraphDao,
    GraphRevisionDao,
    GraphsService,
    GraphRevisionService,
    GraphRevisionQueueService,
    GraphCompiler,
    GraphRegistry,
    GraphAiPreviewService,
    GraphRestorationService,
    GraphMergeService,
    MessageTransformerService,
    GraphStateManager,
    GraphStateFactory,
  ],
  exports: [
    GraphDao,
    GraphRevisionDao,
    GraphCompiler,
    GraphsService,
    GraphRevisionService,
    GraphRevisionQueueService,
    GraphRegistry,
    GraphAiPreviewService,
    GraphRestorationService,
    MessageTransformerService,
    GraphStateManager,
  ],
})
export class GraphsModule implements OnModuleInit {
  constructor(
    private readonly graphRestorationService: GraphRestorationService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (environment.restoreGraphs) {
      this.graphRestorationService.restoreRunningGraphs();
    }
  }
}
