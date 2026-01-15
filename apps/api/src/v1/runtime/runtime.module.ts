import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { RuntimeInstanceDao } from './dao/runtime-instance.dao';
import { RuntimeInstanceEntity } from './entity/runtime-instance.entity';
import { RuntimeCleanupService } from './services/runtime-cleanup.service';
import { RuntimeProvider } from './services/runtime-provider';

@Module({
  imports: [registerEntities([RuntimeInstanceEntity])],
  controllers: [],
  providers: [RuntimeProvider, RuntimeCleanupService, RuntimeInstanceDao],
  exports: [RuntimeProvider, RuntimeInstanceDao],
})
export class RuntimeModule {}
