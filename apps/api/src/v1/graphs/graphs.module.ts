import './graphs.exceptions';

import { forwardRef, Module, OnModuleInit } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { AgentsModule } from '../agents/agents.module';
import { GraphTemplatesModule } from '../graph-templates/graph-templates.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GraphsController } from './controllers/graphs.controller';
import { GraphDao } from './dao/graph.dao';
import { GraphEntity } from './entity/graph.entity';
import { GraphCompiler } from './services/graph-compiler';
import { GraphRegistry } from './services/graph-registry';
import { GraphRestorationService } from './services/graph-restoration.service';
import { GraphsService } from './services/graphs.service';

@Module({
  imports: [
    registerEntities([GraphEntity]),
    GraphTemplatesModule,
    NotificationsModule,
    AgentsModule,
  ],
  controllers: [GraphsController],
  providers: [
    GraphDao,
    GraphsService,
    GraphCompiler,
    GraphRegistry,
    GraphRestorationService,
  ],
  exports: [
    GraphDao,
    GraphCompiler,
    GraphsService,
    GraphRegistry,
    GraphRestorationService,
  ],
})
export class GraphsModule implements OnModuleInit {
  constructor(
    private readonly graphRestorationService: GraphRestorationService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.graphRestorationService.restoreRunningGraphs().catch(console.error);
  }
}
