import { Module } from '@nestjs/common';

import { ManualTrigger } from './services/manual-trigger';

@Module({
  providers: [ManualTrigger],
  exports: [ManualTrigger],
})
export class AgentTriggersModule {}
