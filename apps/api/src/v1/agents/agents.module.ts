import { Module } from '@nestjs/common';

import { AgentOrchestrator } from './services/agents-orchestrator';

@Module({
  imports: [],
  controllers: [],
  providers: [AgentOrchestrator],
  exports: [AgentOrchestrator],
})
export class AgentsModule {}
