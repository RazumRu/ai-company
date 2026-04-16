import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { UserPreferencesDao } from '../dao/user-preferences.dao';
import {
  UpdateUserPreferencesDto,
  UserPreferencesDto,
} from '../dto/user-preferences.dto';
import type {
  ModelPreferences,
  UserPreferencesPayload,
} from '../user-preferences.types';

@Injectable()
export class UserPreferencesService {
  constructor(private readonly userPreferencesDao: UserPreferencesDao) {}

  private prepareResponse(entity: {
    id: string;
    userId: string;
    preferences: UserPreferencesPayload;
    createdAt: Date;
    updatedAt: Date;
  }): UserPreferencesDto {
    const costLimitUsd = entity.preferences?.costLimitUsd ?? null;
    return {
      id: entity.id,
      userId: entity.userId,
      preferences: {
        ...entity.preferences,
        costLimitUsd,
      },
      costLimitUsd,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }

  async getPreferences(ctx: AppContextStorage): Promise<UserPreferencesDto> {
    const userId = ctx.checkSub();
    const existing = await this.userPreferencesDao.getOne({ userId });
    if (!existing) {
      throw new NotFoundException('USER_PREFERENCES_NOT_FOUND');
    }
    return this.prepareResponse(existing);
  }

  async updatePreferences(
    ctx: AppContextStorage,
    dto: UpdateUserPreferencesDto,
  ): Promise<UserPreferencesDto> {
    const userId = ctx.checkSub();

    const existing = await this.userPreferencesDao.getOne({ userId });
    const merged: UserPreferencesPayload = { ...(existing?.preferences ?? {}) };

    if (dto.models !== undefined) {
      const cleanModels: ModelPreferences = {};
      for (const [key, value] of Object.entries(dto.models)) {
        if (value != null) {
          cleanModels[key as keyof ModelPreferences] = value;
        }
      }
      merged.models = cleanModels;
    }

    if (dto.costLimitUsd !== undefined) {
      merged.costLimitUsd = dto.costLimitUsd;
    }

    const updated = await this.userPreferencesDao.upsertByUserId(
      userId,
      merged,
    );

    return this.prepareResponse(updated);
  }

  async getModelOverridesForUser(
    userId: string,
  ): Promise<ModelPreferences | null> {
    const row = await this.userPreferencesDao.getOne({ userId });
    return row?.preferences?.models ?? null;
  }

  async getCostLimitForUser(userId: string): Promise<number | null> {
    const row = await this.userPreferencesDao.getOne({ userId });
    return row?.preferences?.costLimitUsd ?? null;
  }
}
