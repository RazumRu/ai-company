import { Global, Module } from '@nestjs/common';

import { CacheService } from './services/cache.service';
import { ThreadTokenUsageCacheService } from './services/thread-token-usage-cache.service';

@Global()
@Module({
  providers: [CacheService, ThreadTokenUsageCacheService],
  exports: [CacheService, ThreadTokenUsageCacheService],
})
export class CacheModule {}
