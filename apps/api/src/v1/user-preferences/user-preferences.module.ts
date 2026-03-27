import { Module } from '@nestjs/common';
import { registerEntities } from '@packages/mikroorm';

import { UserPreferencesController } from './controllers/user-preferences.controller';
import { UserPreferencesDao } from './dao/user-preferences.dao';
import { UserPreferenceEntity } from './entities/user-preference.entity';
import { UserPreferencesService } from './services/user-preferences.service';

@Module({
  imports: [registerEntities([UserPreferenceEntity])],
  controllers: [UserPreferencesController],
  providers: [UserPreferencesDao, UserPreferencesService],
  exports: [UserPreferencesService],
})
export class UserPreferencesModule {}
