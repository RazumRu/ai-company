import { Module } from '@nestjs/common';

import { SecretsStoreService } from './services/secrets-store.service';

@Module({
  providers: [SecretsStoreService],
  exports: [SecretsStoreService],
})
export class SecretsStoreModule {}
