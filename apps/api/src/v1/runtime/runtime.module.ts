import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/mikroorm';

import { NotificationsModule } from '../notifications/notifications.module';
import { ThreadsDao } from '../threads/dao/threads.dao';
import { ThreadEntity } from '../threads/entity/thread.entity';
import { RuntimeController } from './controllers/runtime.controller';
import { RuntimeInstanceDao } from './dao/runtime-instance.dao';
import { RuntimeInstanceEntity } from './entity/runtime-instance.entity';
import { RuntimeService } from './services/runtime.service';
import { RuntimeCleanupService } from './services/runtime-cleanup.service';
import { RuntimeProvider } from './services/runtime-provider';

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
