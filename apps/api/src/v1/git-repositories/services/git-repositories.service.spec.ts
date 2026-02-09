import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  DefaultLogger,
  InternalException,
  NotFoundException,
} from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LlmModelsService } from '../../litellm/services/llm-models.service';
import { QdrantService } from '../../qdrant/services/qdrant.service';
import { GitRepositoriesDao } from '../dao/git-repositories.dao';
import { RepoIndexDao } from '../dao/repo-index.dao';
import { GetRepositoriesQueryDto } from '../dto/git-repositories.dto';
import { GitRepositoryEntity } from '../entity/git-repository.entity';
import { RepoIndexEntity } from '../entity/repo-index.entity';
import {
  GitRepositoryProvider,
  RepoIndexStatus,
} from '../git-repositories.types';
import { GitRepositoriesService } from './git-repositories.service';
import { RepoIndexQueueService } from './repo-index-queue.service';
import { RepoIndexerService } from './repo-indexer.service';

describe('GitRepositoriesService', () => {
  let service: GitRepositoriesService;
  let dao: GitRepositoriesDao;
  let repoIndexDao: RepoIndexDao;
  let repoIndexQueueService: RepoIndexQueueService;
  let repoIndexerService: RepoIndexerService;
  let qdrantService: QdrantService;

  const mockUserId = 'user-123';
  const mockRepositoryId = 'repo-456';
  const mockCtx = new AuthContextStorage({ sub: mockUserId });

  const createMockRepositoryEntity = (
    overrides: Partial<GitRepositoryEntity> = {},
  ): GitRepositoryEntity =>
    ({
      id: mockRepositoryId,
      owner: 'octocat',
      repo: 'Hello-World',
      url: 'https://github.com/octocat/Hello-World.git',
      provider: GitRepositoryProvider.GITHUB,
      defaultBranch: 'main',
      createdBy: mockUserId,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      deletedAt: null,
      ...overrides,
    }) as GitRepositoryEntity;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GitRepositoriesService,
        {
          provide: GitRepositoriesDao,
          useValue: {
            getAll: vi.fn(),
            getOne: vi.fn(),
            create: vi.fn(),
            updateById: vi.fn(),
            deleteById: vi.fn(),
          },
        },
        {
          provide: RepoIndexDao,
          useValue: {
            getAll: vi.fn(),
            getOne: vi.fn(),
            create: vi.fn(),
            updateById: vi.fn(),
            deleteById: vi.fn(),
            incrementIndexedTokens: vi.fn(),
          },
        },
        {
          provide: RepoIndexQueueService,
          useValue: {
            addIndexJob: vi.fn(),
            setCallbacks: vi.fn(),
            removeJob: vi.fn(),
          },
        },
        {
          provide: RepoIndexerService,
          useValue: {
            deriveRepoId: vi.fn((url: string) => url),
            calculateIndexMetadata: vi.fn().mockResolvedValue({
              embeddingModel: 'text-embedding-3-small',
              vectorSize: 1536,
              chunkingSignatureHash: 'sig-hash-123',
              repoSlug: 'my_repo',
              collection: 'codebase_my_repo_1536',
            }),
          },
        },
        {
          provide: LlmModelsService,
          useValue: {
            getKnowledgeEmbeddingModel: vi.fn(() => 'text-embedding-3-small'),
          },
        },
        {
          provide: QdrantService,
          useValue: {
            raw: {
              deleteCollection: vi.fn(),
            },
          },
        },
        {
          provide: DefaultLogger,
          useValue: {
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<GitRepositoriesService>(GitRepositoriesService);
    dao = module.get<GitRepositoriesDao>(GitRepositoriesDao);
    repoIndexDao = module.get<RepoIndexDao>(RepoIndexDao);
    repoIndexQueueService = module.get<RepoIndexQueueService>(
      RepoIndexQueueService,
    );
    repoIndexerService = module.get<RepoIndexerService>(RepoIndexerService);
    qdrantService = module.get<QdrantService>(QdrantService);
  });

  describe('createRepository', () => {
    it('should create a new repository', async () => {
      const createData = {
        owner: 'octocat',
        repo: 'Hello-World',
        url: 'https://github.com/octocat/Hello-World.git',
        provider: GitRepositoryProvider.GITHUB,
        defaultBranch: 'main',
      };

      vi.spyOn(dao, 'create').mockResolvedValue(createMockRepositoryEntity());

      const result = await service.createRepository(mockCtx, createData);

      expect(dao.create).toHaveBeenCalledWith({
        owner: 'octocat',
        repo: 'Hello-World',
        url: 'https://github.com/octocat/Hello-World.git',
        provider: GitRepositoryProvider.GITHUB,
        defaultBranch: 'main',
        createdBy: mockUserId,
        encryptedToken: null,
      });
      expect(result).toMatchObject({
        owner: 'octocat',
        repo: 'Hello-World',
      });
    });
  });

  describe('updateRepository', () => {
    it('should update existing repository', async () => {
      const existing = createMockRepositoryEntity();
      const updateData = {
        url: 'https://github.com/octocat/Hello-World-New.git',
      };

      vi.spyOn(dao, 'getOne').mockResolvedValue(existing);
      vi.spyOn(dao, 'updateById').mockResolvedValue({
        ...existing,
        url: 'https://github.com/octocat/Hello-World-New.git',
      });

      const result = await service.updateRepository(
        mockCtx,
        mockRepositoryId,
        updateData,
      );

      expect(dao.getOne).toHaveBeenCalledWith({
        id: mockRepositoryId,
        createdBy: mockUserId,
      });
      expect(dao.updateById).toHaveBeenCalledWith(mockRepositoryId, updateData);
      expect(result.url).toBe('https://github.com/octocat/Hello-World-New.git');
    });

    it('should throw NotFoundException when repository not found', async () => {
      vi.spyOn(dao, 'getOne').mockResolvedValue(null);

      await expect(
        service.updateRepository(mockCtx, mockRepositoryId, { url: '...' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getRepositories', () => {
    it('should return repositories for authenticated user', async () => {
      const mockRepositories = [
        createMockRepositoryEntity(),
        createMockRepositoryEntity({
          id: 'repo-789',
          owner: 'facebook',
          repo: 'react',
        }),
      ];

      vi.spyOn(dao, 'getAll').mockResolvedValue(mockRepositories);

      const query: GetRepositoriesQueryDto = {
        limit: 50,
        offset: 0,
      };

      const result = await service.getRepositories(mockCtx, query);

      expect(dao.getAll).toHaveBeenCalledWith({
        createdBy: mockUserId,
        owner: undefined,
        repo: undefined,
        provider: undefined,
        limit: 50,
        offset: 0,
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('getRepositoryById', () => {
    it('should return repository when found', async () => {
      const mockRepository = createMockRepositoryEntity();
      vi.spyOn(dao, 'getOne').mockResolvedValue(mockRepository);

      const result = await service.getRepositoryById(mockCtx, mockRepositoryId);

      expect(dao.getOne).toHaveBeenCalledWith({
        id: mockRepositoryId,
        createdBy: mockUserId,
      });
      expect(result.id).toBe(mockRepositoryId);
    });
  });

  describe('deleteRepository', () => {
    it('should delete repository and cleanup Qdrant collection when it exists', async () => {
      const mockRepository = createMockRepositoryEntity();
      const mockRepoIndex = {
        id: 'index-123',
        repositoryId: mockRepositoryId,
        repoUrl: 'https://github.com/octocat/Hello-World.git',
        qdrantCollection: 'codebase_my_repo_1536',
        status: 'completed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(dao, 'getOne').mockResolvedValue(mockRepository);
      vi.spyOn(repoIndexDao, 'getAll').mockResolvedValue([
        mockRepoIndex as any,
      ]);
      vi.spyOn(qdrantService.raw, 'deleteCollection').mockResolvedValue(
        undefined as any,
      );
      vi.spyOn(dao, 'deleteById').mockResolvedValue(undefined);

      await service.deleteRepository(mockCtx, mockRepositoryId);

      expect(repoIndexDao.getAll).toHaveBeenCalledWith({
        repositoryId: mockRepositoryId,
      });
      expect(qdrantService.raw.deleteCollection).toHaveBeenCalledWith(
        'codebase_my_repo_1536',
      );
      expect(dao.deleteById).toHaveBeenCalledWith(mockRepositoryId);
    });

    it('should delete repository when no repo index exists', async () => {
      const mockRepository = createMockRepositoryEntity();

      vi.spyOn(dao, 'getOne').mockResolvedValue(mockRepository);
      vi.spyOn(repoIndexDao, 'getAll').mockResolvedValue([]);
      vi.spyOn(dao, 'deleteById').mockResolvedValue(undefined);

      await service.deleteRepository(mockCtx, mockRepositoryId);

      expect(dao.deleteById).toHaveBeenCalledWith(mockRepositoryId);
      expect(qdrantService.raw.deleteCollection).not.toHaveBeenCalled();
    });

    it('should delete repository even if Qdrant cleanup fails', async () => {
      const mockRepository = createMockRepositoryEntity();
      const mockRepoIndex = {
        id: 'index-123',
        repositoryId: mockRepositoryId,
        qdrantCollection: 'codebase_my_repo_1536',
      };

      vi.spyOn(dao, 'getOne').mockResolvedValue(mockRepository);
      vi.spyOn(repoIndexDao, 'getAll').mockResolvedValue([
        mockRepoIndex as any,
      ]);
      vi.spyOn(qdrantService.raw, 'deleteCollection').mockRejectedValue(
        new Error('Qdrant connection failed'),
      );
      vi.spyOn(dao, 'deleteById').mockResolvedValue(undefined);

      // Should not throw, just warn and continue
      await service.deleteRepository(mockCtx, mockRepositoryId);

      expect(dao.deleteById).toHaveBeenCalledWith(mockRepositoryId);
    });
  });

  describe('triggerReindex', () => {
    const createMockRepoIndexEntity = (
      overrides: Partial<RepoIndexEntity> = {},
    ): RepoIndexEntity =>
      ({
        id: 'index-123',
        repositoryId: mockRepositoryId,
        repoUrl: 'https://github.com/octocat/Hello-World.git',
        branch: 'main',
        status: RepoIndexStatus.Completed,
        qdrantCollection: 'codebase_my_repo_1536',
        lastIndexedCommit: 'abc123',
        embeddingModel: 'text-embedding-3-small',
        vectorSize: 1536,
        chunkingSignatureHash: 'sig-hash-123',
        estimatedTokens: 1000,
        indexedTokens: 1000,
        errorMessage: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
        ...overrides,
      }) as RepoIndexEntity;

    it('should successfully queue a reindex job for a new index', async () => {
      const mockRepository = createMockRepositoryEntity();

      vi.spyOn(dao, 'getOne').mockResolvedValue(mockRepository);
      vi.spyOn(repoIndexDao, 'getOne').mockResolvedValue(null);
      vi.spyOn(repoIndexDao, 'create').mockResolvedValue(
        createMockRepoIndexEntity({
          status: RepoIndexStatus.Pending,
          indexedTokens: 0,
          estimatedTokens: 0,
        }),
      );

      const result = await service.triggerReindex(mockCtx, {
        repositoryId: mockRepositoryId,
        branch: 'main',
      });

      expect(repoIndexerService.deriveRepoId).toHaveBeenCalledWith(
        mockRepository.url,
      );
      expect(repoIndexerService.calculateIndexMetadata).toHaveBeenCalledWith(
        mockRepositoryId,
        'main',
      );
      expect(repoIndexDao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          repositoryId: mockRepositoryId,
          branch: 'main',
          status: RepoIndexStatus.Pending,
        }),
      );
      expect(repoIndexQueueService.addIndexJob).toHaveBeenCalledWith({
        repoIndexId: 'index-123',
        repoUrl: mockRepository.url,
        branch: 'main',
      });
      expect(result.message).toBe('Repository indexing has been queued');
      expect(result.repoIndex.status).toBe(RepoIndexStatus.Pending);
    });

    it('should throw BadRequestException when indexing is already in progress', async () => {
      const mockRepository = createMockRepositoryEntity();
      const existingIndex = createMockRepoIndexEntity({
        status: RepoIndexStatus.InProgress,
      });

      vi.spyOn(dao, 'getOne').mockResolvedValue(mockRepository);
      vi.spyOn(repoIndexDao, 'getOne').mockResolvedValue(existingIndex);

      await expect(
        service.triggerReindex(mockCtx, {
          repositoryId: mockRepositoryId,
          branch: 'main',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when repository does not belong to user', async () => {
      vi.spyOn(dao, 'getOne').mockResolvedValue(null);

      await expect(
        service.triggerReindex(mockCtx, {
          repositoryId: 'non-existent-repo',
          branch: 'main',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('credential encryption', () => {
    describe('encryptCredential', () => {
      it('produces a string with three colon-separated base64 segments', () => {
        const result = service.encryptCredential('hello');
        const parts = result.split(':');
        expect(parts).toHaveLength(3);
        parts.forEach((part) => {
          expect(() => Buffer.from(part, 'base64')).not.toThrow();
        });
      });

      it('produces different ciphertexts for the same plaintext (IV randomness)', () => {
        const a = service.encryptCredential('secret');
        const b = service.encryptCredential('secret');
        expect(a).not.toBe(b);
      });
    });

    describe('decryptCredential', () => {
      it('round-trips: decrypt(encrypt(x)) === x', () => {
        const original = 'ghp_abc123XYZ';
        const encrypted = service.encryptCredential(original);
        const decrypted = service.decryptCredential(encrypted);
        expect(decrypted).toBe(original);
      });

      it('round-trips with unicode content', () => {
        const original = 'token_with_spëcîal_çhàrs_🔐';
        const encrypted = service.encryptCredential(original);
        const decrypted = service.decryptCredential(encrypted);
        expect(decrypted).toBe(original);
      });

      it('throws DECRYPTION_FAILED with malformed ciphertext', () => {
        expect(() => service.decryptCredential('not-valid')).toThrow(
          InternalException,
        );
      });
    });
  });
});
