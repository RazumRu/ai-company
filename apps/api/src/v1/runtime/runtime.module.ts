import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { NotificationsModule } from '../notifications/notifications.module';
import { ThreadsDao } from '../threads/dao/threads.dao';
import { ThreadEntity } from '../threads/entity/thread.entity';
import { RuntimeController } from './controllers/runtime.controller';
import { RuntimeInstanceDao } from './dao/runtime-instance.dao';
import { RuntimeInstanceEntity } from './entity/runtime-instance.entity';
import { RuntimeCleanupService } from './services/runtime-cleanup.service';
import { RuntimeProvider } from './services/runtime-provider';
import { RuntimeService } from './services/runtime.service';

@Module({
  imports: [
    registerEntities([RuntimeInstanceEntity, ThreadEntity]),
    NotificationsModule,
  ],
  controllers: [RuntimeController],
  providers: [
    RuntimeProvider,
    RuntimeCleanupService,
    RuntimeInstanceDao,
    RuntimeService,
    ThreadsDao,
  ],
  exports: [RuntimeProvider, RuntimeInstanceDao],
})
export class RuntimeModule {}
