import { Module, OnModuleInit } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService, ModuleRef } from '@nestjs/core';
import { registerEntities } from '@packages/typeorm';
import { Class } from 'type-fest';

import { AgentToolsModule } from '../agent-tools/agent-tools.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { GraphCheckpointsDao } from './dao/graph-checkpoints.dao';
import { GraphCheckpointsWritesDao } from './dao/graph-checkpoints-writes.dao';
import { AGENT_FACTORY_KEY } from './decorators/register-agent.decorator';
import { GraphCheckpointEntity } from './entity/graph-chekpoints.entity';
import { GraphCheckpointWritesEntity } from './entity/graph-chekpoints-writes.entity';
import { AgentFactoryService } from './services/agent-factory.service';
import { BaseAgent } from './services/agents/base-agent';
import { SimpleAgent } from './services/agents/simple-agent';
import { PgCheckpointSaver } from './services/pg-checkpoint-saver';

@Module({
  imports: [
    registerEntities([GraphCheckpointEntity, GraphCheckpointWritesEntity]),
    RuntimeModule,
    AgentToolsModule,
    NotificationsModule,
    DiscoveryModule,
  ],
  controllers: [],
  providers: [
    SimpleAgent,
    PgCheckpointSaver,
    GraphCheckpointsDao,
    GraphCheckpointsWritesDao,
    AgentFactoryService,
  ],
  exports: [
    PgCheckpointSaver,
    GraphCheckpointsDao,
    GraphCheckpointsWritesDao,
    AgentFactoryService,
  ],
})
export class AgentsModule implements OnModuleInit {
  constructor(
    private readonly agentFactoryService: AgentFactoryService,
    private readonly discovery: DiscoveryService,
  ) {}

  async onModuleInit() {
    const wrappers = this.discovery.getProviders().filter((w) => w?.metatype);
    for (const w of wrappers) {
      const hasAgentDecorator = Reflect.getMetadata(
        AGENT_FACTORY_KEY,
        w.metatype || {},
      );
      if (!hasAgentDecorator) {
        continue;
      }

      // Register the agent class itself
      this.agentFactoryService.register(w.metatype as Class<BaseAgent<any>>);
    }
  }
}
