import { EntityManager } from '@mikro-orm/postgresql';
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@packages/common';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { SecretsStoreService } from '../../secrets-store/services/secrets-store.service';
import { SecretsDao } from '../dao/secrets.dao';
import { SecretsService } from './secrets.service';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_PROJECT_ID = '11111111-1111-1111-1111-111111111111';

const EMPTY_REQUEST = {
  headers: { 'x-project-id': TEST_PROJECT_ID },
} as unknown as FastifyRequest;

const ctx = new AppContextStorage({ sub: TEST_USER_ID }, EMPTY_REQUEST);

function makeEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'API_KEY',
    description: null,
    projectId: TEST_PROJECT_ID,
    createdBy: TEST_USER_ID,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('SecretsService', () => {
  let service: SecretsService;
  let secretsDao: {
    getOne: ReturnType<typeof vi.fn>;
    getAll: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    deleteById: ReturnType<typeof vi.fn>;
  };
  let secretsStore: {
    putSecret: ReturnType<typeof vi.fn>;
    getSecret: ReturnType<typeof vi.fn>;
    deleteSecret: ReturnType<typeof vi.fn>;
  };
  let em: {
    flush: ReturnType<typeof vi.fn>;
    transactional: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    secretsDao = {
      getOne: vi.fn(),
      getAll: vi.fn(),
      create: vi.fn(),
      deleteById: vi.fn(),
    };

    secretsStore = {
      putSecret: vi.fn(),
      getSecret: vi.fn(),
      deleteSecret: vi.fn(),
    };

    em = {
      flush: vi.fn(),
      transactional: vi
        .fn()
        .mockImplementation(async (fn: (em: unknown) => Promise<unknown>) => {
          const innerEm = { flush: em.flush };
          return fn(innerEm);
        }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretsService,
        { provide: SecretsDao, useValue: secretsDao },
        { provide: SecretsStoreService, useValue: secretsStore },
        { provide: EntityManager, useValue: em },
      ],
    }).compile();

    service = module.get<SecretsService>(SecretsService);
  });

  describe('create', () => {
    it('creates DB record first (inside transaction), then writes to vault, and returns response without value', async () => {
      const entity = makeEntity();
      secretsDao.getOne.mockResolvedValue(null);
      secretsDao.create.mockResolvedValue(entity);
      secretsStore.putSecret.mockResolvedValue(undefined);

      const result = await service.create(ctx, {
        name: 'API_KEY',
        value: 'my-secret-value',
        description: null,
      });

      expect(em.transactional).toHaveBeenCalled();
      expect(secretsDao.create).toHaveBeenCalledWith(
        {
          name: 'API_KEY',
          description: null,
          createdBy: TEST_USER_ID,
          projectId: TEST_PROJECT_ID,
        },
        expect.anything(),
      );
      expect(secretsStore.putSecret).toHaveBeenCalledWith(
        TEST_PROJECT_ID,
        'API_KEY',
        'my-secret-value',
      );
      // DB create must be called before vault write
      const createOrder = secretsDao.create.mock.invocationCallOrder[0] ?? 0;
      const putOrder = secretsStore.putSecret.mock.invocationCallOrder[0] ?? 0;
      expect(createOrder).toBeLessThan(putOrder);
      expect(result).toMatchObject({
        id: entity.id,
        name: 'API_KEY',
        projectId: TEST_PROJECT_ID,
        createdBy: TEST_USER_ID,
      });
      expect(result).not.toHaveProperty('value');
    });

    it('throws ConflictException when secret name already exists', async () => {
      secretsDao.getOne.mockResolvedValue(makeEntity());

      await expect(
        service.create(ctx, {
          name: 'API_KEY',
          value: 'some-value',
          description: null,
        }),
      ).rejects.toThrow(ConflictException);

      expect(secretsStore.putSecret).not.toHaveBeenCalled();
      expect(secretsDao.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns metadata only, ordered by name', async () => {
      const entities = [
        makeEntity({ id: 'bbb', name: 'API_KEY' }),
        makeEntity({ id: 'ccc', name: 'DB_PASS' }),
      ];
      secretsDao.getAll.mockResolvedValue(entities);

      const result = await service.list(ctx);

      expect(secretsDao.getAll).toHaveBeenCalledWith(
        { projectId: TEST_PROJECT_ID },
        { orderBy: { name: 'asc' } },
      );
      expect(result).toHaveLength(2);
      expect(result[0]).not.toHaveProperty('value');
      expect(result[1]).not.toHaveProperty('value');
    });
  });

  describe('getById', () => {
    it('returns the secret response when found', async () => {
      const entity = makeEntity();
      secretsDao.getOne.mockResolvedValue(entity);

      const result = await service.getById(ctx, entity.id);

      expect(result.id).toBe(entity.id);
      expect(result).not.toHaveProperty('value');
    });

    it('throws NotFoundException when not found', async () => {
      secretsDao.getOne.mockResolvedValue(null);

      await expect(service.getById(ctx, 'nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('calls putSecret on OpenBao when value is provided', async () => {
      const entity = makeEntity();
      secretsDao.getOne.mockResolvedValue(entity);
      em.flush.mockResolvedValue(undefined);

      await service.update(ctx, entity.id, {
        value: 'new-value',
      });

      expect(secretsStore.putSecret).toHaveBeenCalledWith(
        TEST_PROJECT_ID,
        'API_KEY',
        'new-value',
      );
      expect(em.transactional).toHaveBeenCalled();
      expect(em.flush).toHaveBeenCalled();
    });

    it('does not touch OpenBao when only description is provided', async () => {
      const entity = makeEntity();
      secretsDao.getOne.mockResolvedValue(entity);
      em.flush.mockResolvedValue(undefined);

      const result = await service.update(ctx, entity.id, {
        description: 'new description',
      });

      expect(secretsStore.putSecret).not.toHaveBeenCalled();
      expect(em.transactional).toHaveBeenCalled();
      expect(em.flush).toHaveBeenCalled();
      expect(result.description).toBe('new description');
    });

    it('calls putSecret when value is empty string (not undefined)', async () => {
      const entity = makeEntity();
      secretsDao.getOne.mockResolvedValue(entity);
      em.flush.mockResolvedValue(undefined);

      await service.update(ctx, entity.id, { value: '' });

      expect(secretsStore.putSecret).toHaveBeenCalledWith(
        TEST_PROJECT_ID,
        'API_KEY',
        '',
      );
    });

    it('throws NotFoundException when secret not found', async () => {
      secretsDao.getOne.mockResolvedValue(null);

      await expect(
        service.update(ctx, 'nonexistent-id', { description: 'desc' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('soft-deletes DB record first, then removes from vault', async () => {
      const entity = makeEntity();
      secretsDao.getOne.mockResolvedValue(entity);
      secretsStore.deleteSecret.mockResolvedValue(undefined);
      secretsDao.deleteById.mockResolvedValue(undefined);

      await service.delete(ctx, entity.id);

      const deleteByIdOrder =
        secretsDao.deleteById.mock.invocationCallOrder[0] ?? 0;
      const deleteSecretOrder =
        secretsStore.deleteSecret.mock.invocationCallOrder[0] ?? 0;
      expect(deleteByIdOrder).toBeLessThan(deleteSecretOrder);
      expect(secretsDao.deleteById).toHaveBeenCalledWith(entity.id);
      expect(secretsStore.deleteSecret).toHaveBeenCalledWith(
        TEST_PROJECT_ID,
        'API_KEY',
      );
    });

    it('throws NotFoundException when secret not found', async () => {
      secretsDao.getOne.mockResolvedValue(null);

      await expect(service.delete(ctx, 'nonexistent-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('resolveSecretValue', () => {
    it('returns value from OpenBao when secret exists', async () => {
      const entity = makeEntity();
      secretsDao.getOne.mockResolvedValue(entity);
      secretsStore.getSecret.mockResolvedValue('resolved-value');

      const result = await service.resolveSecretValue(
        TEST_PROJECT_ID,
        'API_KEY',
      );

      expect(result).toBe('resolved-value');
      expect(secretsStore.getSecret).toHaveBeenCalledWith(
        TEST_PROJECT_ID,
        'API_KEY',
      );
    });

    it('throws NotFoundException when secret name does not exist', async () => {
      secretsDao.getOne.mockResolvedValue(null);

      await expect(
        service.resolveSecretValue(TEST_PROJECT_ID, 'MISSING_KEY'),
      ).rejects.toThrow(NotFoundException);

      expect(secretsStore.getSecret).not.toHaveBeenCalled();
    });
  });

  describe('batchResolveSecretValues', () => {
    it('returns empty map when no names provided', async () => {
      const result = await service.batchResolveSecretValues(
        TEST_PROJECT_ID,
        [],
      );
      expect(result.size).toBe(0);
      expect(secretsDao.getAll).not.toHaveBeenCalled();
    });

    it('fetches all secrets in parallel and returns a name->value map', async () => {
      secretsDao.getAll.mockResolvedValue([
        makeEntity({ name: 'API_KEY' }),
        makeEntity({ id: 'bbb', name: 'DB_PASS' }),
      ]);
      secretsStore.getSecret
        .mockResolvedValueOnce('key-value')
        .mockResolvedValueOnce('db-pass-value');

      const result = await service.batchResolveSecretValues(TEST_PROJECT_ID, [
        'API_KEY',
        'DB_PASS',
      ]);

      expect(secretsDao.getAll).toHaveBeenCalledWith({
        projectId: TEST_PROJECT_ID,
        name: { $in: ['API_KEY', 'DB_PASS'] },
      });
      expect(result.get('API_KEY')).toBe('key-value');
      expect(result.get('DB_PASS')).toBe('db-pass-value');
    });

    it('throws NotFoundException when a requested secret is not found in DB', async () => {
      secretsDao.getAll.mockResolvedValue([makeEntity({ name: 'API_KEY' })]);

      await expect(
        service.batchResolveSecretValues(TEST_PROJECT_ID, [
          'API_KEY',
          'MISSING',
        ]),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
