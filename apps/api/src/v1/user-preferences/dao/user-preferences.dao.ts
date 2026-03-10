import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource } from 'typeorm';

import { UserPreferenceEntity } from '../entities/user-preference.entity';
import type { UserPreferencesPayload } from '../user-preferences.types';

export type UserPreferenceSearchTerms = Partial<{
  userId: string;
}>;

@Injectable()
export class UserPreferencesDao extends BaseDao<
  UserPreferenceEntity,
  UserPreferenceSearchTerms
> {
  public get alias() {
    return 'up';
  }

  protected get entity() {
    return UserPreferenceEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<UserPreferenceEntity>,
    params?: UserPreferenceSearchTerms,
  ) {
    if (params?.userId) {
      builder.andWhere({ userId: params.userId });
    }
  }

  async upsertByUserId(
    userId: string,
    preferences: UserPreferencesPayload,
  ): Promise<UserPreferenceEntity> {
    const results = await this.upsertMany(
      [{ userId, preferences }],
      ['userId'],
    );
    const result = results[0];
    if (!result) {
      throw new Error('Upsert returned no rows');
    }
    return result;
  }
}
