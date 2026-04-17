import { Test, TestingModule } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { UserPreferencesDao } from '../dao/user-preferences.dao';
import { UserPreferencesService } from './user-preferences.service';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const EMPTY_REQUEST = { headers: {} } as unknown as FastifyRequest;
const ctx = new AppContextStorage({ sub: TEST_USER_ID }, EMPTY_REQUEST);

const mockDao = {
  getOne: vi.fn(),
  upsertByUserId: vi.fn(),
};

describe('UserPreferencesService', () => {
  let service: UserPreferencesService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserPreferencesService,
        { provide: UserPreferencesDao, useValue: mockDao },
      ],
    }).compile();

    service = module.get<UserPreferencesService>(UserPreferencesService);
  });

  describe('getPreferences', () => {
    it('should return existing row when one exists', async () => {
      const existing = {
        id: 'some-uuid',
        userId: TEST_USER_ID,
        preferences: { models: { llmLargeModel: 'custom-model' } },
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      };
      mockDao.getOne.mockResolvedValue(existing);

      const result = await service.getPreferences(ctx);

      expect(result.id).toBe('some-uuid');
      expect(result.userId).toBe(TEST_USER_ID);
      expect(result.preferences.models?.llmLargeModel).toBe('custom-model');
      expect(mockDao.upsertByUserId).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when no row exists', async () => {
      mockDao.getOne.mockResolvedValue(null);

      await expect(service.getPreferences(ctx)).rejects.toThrow(
        'USER_PREFERENCES_NOT_FOUND',
      );
      expect(mockDao.upsertByUserId).not.toHaveBeenCalled();
      expect(mockDao.getOne).toHaveBeenCalledWith({ userId: TEST_USER_ID });
    });

    it('should expose top-level costLimitUsd projection from stored JSONB', async () => {
      const existing = {
        id: 'some-uuid',
        userId: TEST_USER_ID,
        preferences: { costLimitUsd: 3.5 },
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      };
      mockDao.getOne.mockResolvedValue(existing);

      const result = await service.getPreferences(ctx);

      expect(result.costLimitUsd).toBe(3.5);
      expect(result.preferences.costLimitUsd).toBe(3.5);
    });
  });

  describe('updatePreferences', () => {
    it('should write models when dto provides models', async () => {
      mockDao.getOne.mockResolvedValue(null);
      mockDao.upsertByUserId.mockImplementation(
        (_userId: string, preferences: Record<string, unknown>) => ({
          id: 'existing-uuid',
          userId: TEST_USER_ID,
          preferences,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      await service.updatePreferences(ctx, {
        models: { llmLargeModel: 'new-large' },
      });

      expect(mockDao.upsertByUserId).toHaveBeenCalledWith(TEST_USER_ID, {
        models: { llmLargeModel: 'new-large' },
      });
    });

    it('should create row on first update when no row exists', async () => {
      mockDao.getOne.mockResolvedValue(null);
      mockDao.upsertByUserId.mockImplementation(
        (_userId: string, preferences: Record<string, unknown>) => ({
          id: 'new-uuid',
          userId: TEST_USER_ID,
          preferences,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const result = await service.updatePreferences(ctx, {
        models: { llmMiniModel: 'mini-model' },
      });

      expect(result.id).toBe('new-uuid');
      expect(mockDao.upsertByUserId).toHaveBeenCalledWith(TEST_USER_ID, {
        models: { llmMiniModel: 'mini-model' },
      });
    });

    it('should not touch models when dto omits models', async () => {
      mockDao.getOne.mockResolvedValue(null);
      mockDao.upsertByUserId.mockImplementation(
        (_userId: string, preferences: Record<string, unknown>) => ({
          id: 'existing-uuid',
          userId: TEST_USER_ID,
          preferences,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      await service.updatePreferences(ctx, {});

      expect(mockDao.upsertByUserId).toHaveBeenCalledWith(TEST_USER_ID, {});
    });

    it('should write costLimitUsd through to stored JSONB', async () => {
      mockDao.getOne.mockResolvedValue(null);
      mockDao.upsertByUserId.mockImplementation(
        (_userId: string, preferences: Record<string, unknown>) => ({
          id: 'new-uuid',
          userId: TEST_USER_ID,
          preferences,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const result = await service.updatePreferences(ctx, {
        costLimitUsd: 5,
      });

      expect(mockDao.upsertByUserId).toHaveBeenCalledWith(TEST_USER_ID, {
        costLimitUsd: 5,
      });
      expect(result.costLimitUsd).toBe(5);
      expect(result.preferences.costLimitUsd).toBe(5);
    });

    it('should preserve existing models when only costLimitUsd is updated', async () => {
      mockDao.getOne.mockResolvedValue({
        id: 'existing-uuid',
        userId: TEST_USER_ID,
        preferences: { models: { llmLargeModel: 'x' } },
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      });
      mockDao.upsertByUserId.mockImplementation(
        (_userId: string, preferences: Record<string, unknown>) => ({
          id: 'existing-uuid',
          userId: TEST_USER_ID,
          preferences,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      await service.updatePreferences(ctx, { costLimitUsd: 2 });

      expect(mockDao.upsertByUserId).toHaveBeenCalledWith(TEST_USER_ID, {
        models: { llmLargeModel: 'x' },
        costLimitUsd: 2,
      });
    });

    it('should preserve existing costLimitUsd when only models is updated', async () => {
      mockDao.getOne.mockResolvedValue({
        id: 'existing-uuid',
        userId: TEST_USER_ID,
        preferences: { costLimitUsd: 2 },
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      });
      mockDao.upsertByUserId.mockImplementation(
        (_userId: string, preferences: Record<string, unknown>) => ({
          id: 'existing-uuid',
          userId: TEST_USER_ID,
          preferences,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      await service.updatePreferences(ctx, {
        models: { llmLargeModel: 'y' },
      });

      expect(mockDao.upsertByUserId).toHaveBeenCalledWith(TEST_USER_ID, {
        costLimitUsd: 2,
        models: { llmLargeModel: 'y' },
      });
    });
  });

  describe('getModelOverridesForUser', () => {
    it('should return null when no row exists', async () => {
      mockDao.getOne.mockResolvedValue(null);

      const result = await service.getModelOverridesForUser(TEST_USER_ID);

      expect(result).toBeNull();
    });

    it('should return model overrides when row exists', async () => {
      mockDao.getOne.mockResolvedValue({
        id: 'some-uuid',
        userId: TEST_USER_ID,
        preferences: {
          models: { llmLargeModel: 'override-model' },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getModelOverridesForUser(TEST_USER_ID);

      expect(result).toEqual({ llmLargeModel: 'override-model' });
    });

    it('should return null when row exists but no models', async () => {
      mockDao.getOne.mockResolvedValue({
        id: 'some-uuid',
        userId: TEST_USER_ID,
        preferences: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getModelOverridesForUser(TEST_USER_ID);

      expect(result).toBeNull();
    });
  });

  describe('getCostLimitForUser', () => {
    it('should return null when no row exists', async () => {
      mockDao.getOne.mockResolvedValue(null);

      const result = await service.getCostLimitForUser(TEST_USER_ID);

      expect(result).toBeNull();
    });

    it('should return null when row exists but payload missing costLimitUsd', async () => {
      mockDao.getOne.mockResolvedValue({
        id: 'some-uuid',
        userId: TEST_USER_ID,
        preferences: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getCostLimitForUser(TEST_USER_ID);

      expect(result).toBeNull();
    });

    it('should return the value when present', async () => {
      mockDao.getOne.mockResolvedValue({
        id: 'some-uuid',
        userId: TEST_USER_ID,
        preferences: { costLimitUsd: 7.25 },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getCostLimitForUser(TEST_USER_ID);

      expect(result).toBe(7.25);
    });
  });
});
