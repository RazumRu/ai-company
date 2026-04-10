import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/mikroorm';

import { SecretsStoreModule } from '../secrets-store/secrets-store.module';
import { SecretsController } from './controllers/secrets.controller';
import { SecretsDao } from './dao/secrets.dao';
import { SecretEntity } from './entity/secret.entity';
import { SecretsService } from './services/secrets.service';

@Module({
  imports: [registerEntities([SecretEntity]), SecretsStoreModule],
  controllers: [SecretsController],
  providers: [SecretsDao, SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
