import './graphs.exceptions';

import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { GraphTemplatesModule } from '../graph-templates/graph-templates.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GraphsController } from './controllers/graphs.controller';
import { GraphDao } from './dao/graph.dao';
import { GraphEntity } from './entity/graph.entity';
import { GraphCompiler } from './services/graph-compiler';
import { GraphRegistry } from './services/graph-registry';
import { GraphsService } from './services/graphs.service';

@Module({
  imports: [
    registerEntities([GraphEntity]),
    GraphTemplatesModule,
    NotificationsModule,
  ],
  controllers: [GraphsController],
  providers: [GraphDao, GraphsService, GraphCompiler, GraphRegistry],
  exports: [GraphCompiler, GraphsService, GraphRegistry],
})
export class GraphsModule {}
