import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/typeorm';

import { GraphsModule } from '../graphs/graphs.module';
import { ThreadsController } from './controllers/threads.controller';
import { MessagesDao } from './dao/messages.dao';
import { ThreadsDao } from './dao/threads.dao';
import { MessageEntity } from './entity/message.entity';
import { ThreadEntity } from './entity/thread.entity';
import { ThreadsService } from './services/threads.service';

@Module({
  imports: [registerEntities([ThreadEntity, MessageEntity]), GraphsModule],
  controllers: [ThreadsController],
  providers: [ThreadsService, ThreadsDao, MessagesDao],
  exports: [ThreadsDao, MessagesDao, ThreadsService],
})
export class ThreadsModule {}
