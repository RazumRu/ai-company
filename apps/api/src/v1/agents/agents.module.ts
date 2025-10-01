import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { AgentToolsModule } from '../agent-tools/agent-tools.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { GraphCheckpointsDao } from './dao/graph-checkpoints.dao';
import { GraphCheckpointsWritesDao } from './dao/graph-checkpoints-writes.dao';
import { GraphCheckpointEntity } from './entity/graph-chekpoints.entity';
import { GraphCheckpointWritesEntity } from './entity/graph-chekpoints-writes.entity';
import { SimpleAgent } from './services/agents/simple-agent';
import { PgCheckpointSaver } from './services/pg-checkpoint-saver';

@Module({
  imports: [
    registerEntities([GraphCheckpointEntity, GraphCheckpointWritesEntity]),
    RuntimeModule,
    AgentToolsModule,
  ],
  controllers: [],
  providers: [
    SimpleAgent,
    PgCheckpointSaver,
    GraphCheckpointsDao,
    GraphCheckpointsWritesDao,
  ],
  exports: [
    SimpleAgent,
    PgCheckpointSaver,
    GraphCheckpointsDao,
    GraphCheckpointsWritesDao,
  ],
})
export class AgentsModule {}
