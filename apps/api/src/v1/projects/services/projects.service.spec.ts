import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import { TypeormService } from '@packages/typeorm';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { GitRepositoriesDao } from '../../git-repositories/dao/git-repositories.dao';
import { GraphDao } from '../../graphs/dao/graph.dao';
import { KnowledgeDocDao } from '../../knowledge/dao/knowledge-doc.dao';
import { ProjectsDao } from '../dao/projects.dao';
import { ProjectsStatsDao } from '../dao/projects-stats.dao';
import { CreateProjectDto, UpdateProjectDto } from '../dto/projects.dto';
import { ProjectEntity } from '../entity/project.entity';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let projectsDao: ProjectsDao;
  let projectsStatsDao: ProjectsStatsDao;
  let typeorm: TypeormService;
  let graphDao: GraphDao;
  let knowledgeDocDao: KnowledgeDocDao;
  let gitRepositoriesDao: GitRepositoriesDao;

  const mockUserId = 'user-123';
  const mockProjectId = 'project-456';
  const mockCtx = new AppContextStorage(
    { sub: mockUserId },
    { headers: {} } as unknown as FastifyRequest,
  );

  const createMockProjectEntity = (
    overrides: Partial<ProjectEntity> = {},
  ): ProjectEntity => ({
    id: mockProjectId,
    name: 'Test Project',
    description: 'A test project',
    icon: null,
    color: null,
    settings: {},
    createdBy: mockUserId,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        {
          provide: ProjectsDao,
          useValue: {
            create: vi.fn(),
            getOne: vi.fn(),
            getAll: vi.fn(),
            updateById: vi.fn(),
            deleteById: vi.fn(),
          },
        },
        {
          provide: ProjectsStatsDao,
          useValue: {
            countStatsByProjectIds: vi.fn().mockResolvedValue([]),
          },
        },
        {
          provide: TypeormService,
          useValue: {
            trx: vi.fn(),
          },
        },
        {
          provide: GraphDao,
          useValue: {
            delete: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: KnowledgeDocDao,
          useValue: {
            delete: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: GitRepositoriesDao,
          useValue: {
            delete: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    projectsDao = module.get<ProjectsDao>(ProjectsDao);
    projectsStatsDao = module.get<ProjectsStatsDao>(ProjectsStatsDao);
    typeorm = module.get<TypeormService>(TypeormService);
    graphDao = module.get<GraphDao>(GraphDao);
    knowledgeDocDao = module.get<KnowledgeDocDao>(KnowledgeDocDao);
    gitRepositoriesDao = module.get<GitRepositoriesDao>(GitRepositoriesDao);

    vi.mocked(typeorm.trx).mockImplementation(async (cb) => cb({} as never));
  });

  describe('create', () => {
    it('should create a project with the correct owner', async () => {
      const dto: CreateProjectDto = {
        name: 'My Project',
        description: 'Desc',
        icon: null,
        color: null,
        settings: {},
      };

      const entity = createMockProjectEntity({ name: 'My Project', description: 'Desc' });
      vi.mocked(projectsDao.create).mockResolvedValue(entity);

      const result = await service.create(mockCtx, dto);

      expect(result.id).toBe(mockProjectId);
      expect(result.name).toBe('My Project');
      expect(projectsDao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'My Project',
          createdBy: mockUserId,
        }),
        expect.anything(),
      );
    });

    it('should propagate DAO errors', async () => {
      const dto: CreateProjectDto = { name: 'Bad Project', settings: {} };
      vi.mocked(projectsDao.create).mockRejectedValue(new Error('DB error'));

      await expect(service.create(mockCtx, dto)).rejects.toThrow('DB error');
    });
  });

  describe('findById', () => {
    it('should return a project belonging to the current user', async () => {
      const entity = createMockProjectEntity();
      vi.mocked(projectsDao.getOne).mockResolvedValue(entity);

      const result = await service.findById(mockCtx, mockProjectId);

      expect(result.id).toBe(mockProjectId);
      expect(projectsDao.getOne).toHaveBeenCalledWith({
        id: mockProjectId,
        createdBy: mockUserId,
      });
    });

    it('should throw NotFoundException when the project does not exist', async () => {
      vi.mocked(projectsDao.getOne).mockResolvedValue(null);

      await expect(service.findById(mockCtx, mockProjectId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException when the project belongs to a different user', async () => {
      // getOne filters by createdBy, so null means not found / wrong owner
      vi.mocked(projectsDao.getOne).mockResolvedValue(null);

      await expect(
        service.findById(new AppContextStorage({ sub: 'other-user' }, { headers: {} } as unknown as FastifyRequest), mockProjectId),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAll', () => {
    it('should return projects belonging to the current user', async () => {
      const entities = [
        createMockProjectEntity({ id: 'p1', name: 'Alpha' }),
        createMockProjectEntity({ id: 'p2', name: 'Beta' }),
      ];
      vi.mocked(projectsDao.getAll).mockResolvedValue(entities);

      const result = await service.getAll(mockCtx);

      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe('Alpha');
      expect(result[0]?.graphCount).toBe(0);
      expect(result[0]?.threadCount).toBe(0);
      expect(projectsDao.getAll).toHaveBeenCalledWith(
        expect.objectContaining({ createdBy: mockUserId }),
      );
    });

    it('should return empty array when user has no projects', async () => {
      vi.mocked(projectsDao.getAll).mockResolvedValue([]);

      const result = await service.getAll(mockCtx);

      expect(result).toEqual([]);
    });

    it('should enrich projects with graph and thread counts', async () => {
      const entities = [
        createMockProjectEntity({ id: 'p1', name: 'Alpha' }),
        createMockProjectEntity({ id: 'p2', name: 'Beta' }),
      ];
      vi.mocked(projectsDao.getAll).mockResolvedValue(entities);
      vi.mocked(projectsStatsDao.countStatsByProjectIds).mockResolvedValue([
        { projectId: 'p1', graphCount: '3', threadCount: '10' },
        { projectId: 'p2', graphCount: '1', threadCount: '5' },
      ]);

      const result = await service.getAll(mockCtx);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({ id: 'p1', graphCount: 3, threadCount: 10 }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({ id: 'p2', graphCount: 1, threadCount: 5 }),
      );
      expect(projectsStatsDao.countStatsByProjectIds).toHaveBeenCalledWith([
        'p1',
        'p2',
      ]);
    });

    it('should return zero counts when stats map has no entry for a project', async () => {
      const entities = [
        createMockProjectEntity({ id: 'p1', name: 'Alpha' }),
        createMockProjectEntity({ id: 'p2', name: 'Beta' }),
      ];
      vi.mocked(projectsDao.getAll).mockResolvedValue(entities);
      vi.mocked(projectsStatsDao.countStatsByProjectIds).mockResolvedValue([]);

      const result = await service.getAll(mockCtx);

      expect(result).toHaveLength(2);
      expect(result[0]?.graphCount).toBe(0);
      expect(result[0]?.threadCount).toBe(0);
      expect(result[1]?.graphCount).toBe(0);
      expect(result[1]?.threadCount).toBe(0);
    });
  });

  describe('update', () => {
    it('should update a project name', async () => {
      const dto: UpdateProjectDto = { name: 'Updated Name' };
      const existingEntity = createMockProjectEntity();
      const updatedEntity = createMockProjectEntity({ name: 'Updated Name' });

      vi.mocked(projectsDao.getOne).mockResolvedValue(existingEntity);
      vi.mocked(projectsDao.updateById).mockResolvedValue(updatedEntity);

      const result = await service.update(mockCtx, mockProjectId, dto);

      expect(result.name).toBe('Updated Name');
    });

    it('should throw NotFoundException when project not found during update', async () => {
      vi.mocked(projectsDao.getOne).mockResolvedValue(null);

      await expect(
        service.update(mockCtx, mockProjectId, { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete', () => {
    it('should cascade delete children via DAOs and soft-delete the project', async () => {
      const entity = createMockProjectEntity();
      vi.mocked(projectsDao.getOne).mockResolvedValue(entity);

      await service.delete(mockCtx, mockProjectId);

      expect(graphDao.delete).toHaveBeenCalledWith({ projectId: mockProjectId, createdBy: mockUserId });
      expect(knowledgeDocDao.delete).toHaveBeenCalledWith({ projectId: mockProjectId, createdBy: mockUserId });
      expect(gitRepositoriesDao.delete).toHaveBeenCalledWith({ projectId: mockProjectId, createdBy: mockUserId });
      expect(projectsDao.deleteById).toHaveBeenCalledWith(mockProjectId);
    });

    it('should throw NotFoundException when project not found during delete', async () => {
      vi.mocked(projectsDao.getOne).mockResolvedValue(null);

      await expect(service.delete(mockCtx, mockProjectId)).rejects.toThrow(
        NotFoundException,
      );

      expect(graphDao.delete).not.toHaveBeenCalled();
      expect(projectsDao.deleteById).not.toHaveBeenCalled();
    });
  });
});
