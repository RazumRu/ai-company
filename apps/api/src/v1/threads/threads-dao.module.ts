import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/mikroorm';

import { ThreadsDao } from './dao/threads.dao';
import { ThreadEntity } from './entity/thread.entity';

/**
 * Lightweight module that provides only ThreadsDao and its required entity.
 * Used by modules that need ThreadsDao without pulling in the full ThreadsModule
 * dependency chain (which would create a circular dependency via AgentsModule).
 */
@Module({
  imports: [registerEntities([ThreadEntity])],
  providers: [ThreadsDao],
  exports: [ThreadsDao],
})
export class ThreadsDaoModule {}
