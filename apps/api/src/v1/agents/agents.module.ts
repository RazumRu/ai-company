import { Module } from '@nestjs/common';

import { AgentOrchestrator } from '../graphs/agents-orchestrator';

@Module({
  imports: [],
  controllers: [],
  providers: [AgentOrchestrator],
  exports: [AgentOrchestrator],
})
export class AgentsModule {}
