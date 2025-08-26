import { Module } from '@nestjs/common';

import { RuntimeOrchestrator } from './services/runtime-orchestrator';

@Module({
  imports: [],
  controllers: [],
  providers: [RuntimeOrchestrator],
  exports: [RuntimeOrchestrator],
})
export class RuntimeModule {}
