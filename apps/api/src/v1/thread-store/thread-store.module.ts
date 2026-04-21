import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/mikroorm';

import { NotificationsModule } from '../notifications/notifications.module';
import { ThreadsDaoModule } from '../threads/threads-dao.module';
import { ThreadStoreController } from './controllers/thread-store.controller';
import { ThreadStoreDao } from './dao/thread-store.dao';
import { ThreadStoreEntryEntity } from './entity/thread-store-entry.entity';
import { ThreadStoreService } from './services/thread-store.service';

@Module({
  imports: [
    registerEntities([ThreadStoreEntryEntity]),
    NotificationsModule,
    ThreadsDaoModule,
  ],
  controllers: [ThreadStoreController],
  providers: [ThreadStoreDao, ThreadStoreService],
  exports: [ThreadStoreService, ThreadStoreDao],
})
export class ThreadStoreModule {}
