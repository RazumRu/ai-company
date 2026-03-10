import { Test, TestingModule } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { UserPreferencesDao } from '../dao/user-preferences.dao';
import { UserPreferencesService } from './user-preferences.service';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const EMPTY_REQUEST = { headers: {} } as unknown as FastifyRequest;
const ctx = new AppContextStorage(
  { sub: TEST_USER_ID },
  EMPTY_REQUEST,
);

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
  });

  describe('updatePreferences', () => {
    it('should replace models — no merge with existing', async () => {
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
      expect(mockDao.getOne).not.toHaveBeenCalled();
    });

    it('should create row on first update when no row exists', async () => {
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

    it('should use empty models object when models not provided in dto', async () => {
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

      expect(mockDao.upsertByUserId).toHaveBeenCalledWith(TEST_USER_ID, {
        models: {},
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
});
