import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { UserPreferenceEntity } from '../entities/user-preference.entity';
import type { UserPreferencesPayload } from '../user-preferences.types';

@Injectable()
export class UserPreferencesDao extends BaseDao<UserPreferenceEntity> {
  constructor(em: EntityManager) {
    super(em, UserPreferenceEntity);
  }

  async upsertByUserId(
    userId: string,
    preferences: UserPreferencesPayload,
  ): Promise<UserPreferenceEntity> {
    const result = await this.getRepo().upsert(
      { userId, preferences },
      {
        onConflictFields: ['userId'],
        onConflictAction: 'merge',
        onConflictMergeFields: ['preferences'],
      },
    );
    return result;
  }
}
