import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GitRepositoriesDao } from '../dao/git-repositories.dao';
import { GetRepositoriesQueryDto } from '../dto/git-repositories.dto';
import { GitRepositoryEntity } from '../entity/git-repository.entity';
import { GitRepositoryProvider } from '../git-repositories.types';
import { GitRepositoriesService } from './git-repositories.service';

describe('GitRepositoriesService', () => {
  let service: GitRepositoriesService;
  let dao: GitRepositoriesDao;

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
      ],
    }).compile();

    service = module.get<GitRepositoriesService>(GitRepositoriesService);
    dao = module.get<GitRepositoriesDao>(GitRepositoriesDao);
  });

  describe('createRepository', () => {
    it('should create a new repository', async () => {
      const createData = {
        owner: 'octocat',
        repo: 'Hello-World',
        url: 'https://github.com/octocat/Hello-World.git',
        provider: GitRepositoryProvider.GITHUB,
      };

      vi.spyOn(dao, 'create').mockResolvedValue(createMockRepositoryEntity());

      const result = await service.createRepository(mockCtx, createData);

      expect(dao.create).toHaveBeenCalledWith({
        owner: 'octocat',
        repo: 'Hello-World',
        url: 'https://github.com/octocat/Hello-World.git',
        provider: GitRepositoryProvider.GITHUB,
        createdBy: mockUserId,
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
    it('should delete repository when owned by user', async () => {
      const mockRepository = createMockRepositoryEntity();

      vi.spyOn(dao, 'getOne').mockResolvedValue(mockRepository);
      vi.spyOn(dao, 'deleteById').mockResolvedValue(undefined);

      await service.deleteRepository(mockCtx, mockRepositoryId);

      expect(dao.deleteById).toHaveBeenCalledWith(mockRepositoryId);
    });
  });
});
