import type { INestApplication } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { UserPreferencesDao } from '../../../v1/user-preferences/dao/user-preferences.dao';
import { UserPreferencesService } from '../../../v1/user-preferences/services/user-preferences.service';
import { createTestModule, TEST_USER_ID } from '../setup';

const EMPTY_REQUEST = { headers: {} } as unknown as FastifyRequest;
const OTHER_USER_ID = '00000000-0000-0000-0000-000000000099';

const ctx = new AppContextStorage({ sub: TEST_USER_ID }, EMPTY_REQUEST);
const otherCtx = new AppContextStorage({ sub: OTHER_USER_ID }, EMPTY_REQUEST);

describe('UserPreferencesService (integration)', () => {
  let app: INestApplication;
  let service: UserPreferencesService;
  let dao: UserPreferencesDao;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    app = await createTestModule();
    service = app.get(UserPreferencesService);
    dao = app.get(UserPreferencesDao);
    const dataSource = app.get(DataSource);
    await dataSource.synchronize();
  }, 120_000);

  afterEach(async () => {
    for (const userId of createdUserIds) {
      const row = await dao.getOne({ userId });
      if (row) {
        await dao.hardDeleteById(row.id);
      }
    }
    createdUserIds.length = 0;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('getPreferences', () => {
    it('should throw NotFoundException when no row exists', async () => {
      await expect(service.getPreferences(ctx)).rejects.toThrow(
        'USER_PREFERENCES_NOT_FOUND',
      );
    });

    it('should return existing row when one exists', async () => {
      createdUserIds.push(TEST_USER_ID);

      await service.updatePreferences(ctx, {
        models: { llmLargeModel: 'custom-model' },
      });

      const result = await service.getPreferences(ctx);

      expect(result.userId).toBe(TEST_USER_ID);
      expect(result.preferences.models?.llmLargeModel).toBe('custom-model');
      expect(result.id).toBeDefined();
      expect(result.id).not.toBe('');
    });
  });

  describe('updatePreferences', () => {
    it('should create row and set model overrides on first update', async () => {
      createdUserIds.push(TEST_USER_ID);

      const result = await service.updatePreferences(ctx, {
        models: { llmLargeModel: 'custom-large-model' },
      });

      expect(result.preferences.models?.llmLargeModel).toBe(
        'custom-large-model',
      );
      expect(result.id).toBeDefined();
      expect(result.id).not.toBe('');
    });

    it('should replace models entirely — no merge with previous values', async () => {
      createdUserIds.push(TEST_USER_ID);

      await service.updatePreferences(ctx, {
        models: { llmLargeModel: 'model-a', llmMiniModel: 'model-b' },
      });
      const result = await service.updatePreferences(ctx, {
        models: { llmLargeModel: 'model-c' },
      });

      expect(result.preferences.models?.llmLargeModel).toBe('model-c');
      expect(result.preferences.models?.llmMiniModel).toBeUndefined();
    });

    it('should clear all models when empty object is passed', async () => {
      createdUserIds.push(TEST_USER_ID);

      await service.updatePreferences(ctx, {
        models: { llmLargeModel: 'model-a' },
      });
      const result = await service.updatePreferences(ctx, {
        models: {},
      });

      expect(result.preferences.models).toEqual({});
    });
  });

  describe('getModelOverridesForUser', () => {
    it('should return null when no preference exists', async () => {
      const result = await service.getModelOverridesForUser(OTHER_USER_ID);

      expect(result).toBeNull();
    });

    it('should return model overrides for an existing user', async () => {
      createdUserIds.push(TEST_USER_ID);

      await service.updatePreferences(ctx, {
        models: { llmEmbeddingModel: 'custom-embedding' },
      });

      const result = await service.getModelOverridesForUser(TEST_USER_ID);

      expect(result).toEqual({ llmEmbeddingModel: 'custom-embedding' });
    });
  });

  describe('isolation between users', () => {
    it('should not leak preferences between users', async () => {
      createdUserIds.push(TEST_USER_ID, OTHER_USER_ID);

      await service.updatePreferences(ctx, {
        models: { llmLargeModel: 'user-1-model' },
      });
      await service.updatePreferences(otherCtx, {
        models: { llmLargeModel: 'user-2-model' },
      });

      const user1 = await service.getPreferences(ctx);
      const user2 = await service.getPreferences(otherCtx);

      expect(user1.preferences.models?.llmLargeModel).toBe('user-1-model');
      expect(user2.preferences.models?.llmLargeModel).toBe('user-2-model');
    });
  });
});
