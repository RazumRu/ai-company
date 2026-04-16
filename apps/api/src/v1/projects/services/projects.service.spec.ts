import { EntityManager } from '@mikro-orm/postgresql';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@packages/common';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { ProjectsDao } from '../dao/projects.dao';
import { ProjectsStatsDao } from '../dao/projects-stats.dao';
import { CreateProjectDto, UpdateProjectDto } from '../dto/projects.dto';
import { ProjectEntity } from '../entity/project.entity';
import { PROJECT_DELETED_EVENT, ProjectDeletedEvent } from '../projects.events';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let projectsDao: ProjectsDao;
  let projectsStatsDao: ProjectsStatsDao;
  let em: EntityManager;
  let eventEmitter: EventEmitter2;

  const mockUserId = 'user-123';
  const mockProjectId = 'project-456';
  const mockCtx = new AppContextStorage({ sub: mockUserId }, {
    headers: {},
  } as unknown as FastifyRequest);

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
          provide: EntityManager,
          useValue: {
            transactional: vi.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emitAsync: vi.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
    projectsDao = module.get<ProjectsDao>(ProjectsDao);
    projectsStatsDao = module.get<ProjectsStatsDao>(ProjectsStatsDao);
    em = module.get<EntityManager>(EntityManager);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    vi.mocked(em.transactional).mockImplementation(async (cb) =>
      cb({} as never),
    );
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

      const entity = createMockProjectEntity({
        name: 'My Project',
        description: 'Desc',
      });
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

    it('should merge top-level costLimitUsd into persisted settings', async () => {
      const dto: CreateProjectDto = {
        name: 'With Limit',
        settings: {},
        costLimitUsd: 4.25,
      };
      const entity = createMockProjectEntity({
        name: 'With Limit',
        settings: { costLimitUsd: 4.25 },
      });
      vi.mocked(projectsDao.create).mockResolvedValue(entity);

      const result = await service.create(mockCtx, dto);

      expect(projectsDao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: { costLimitUsd: 4.25 },
        }),
        expect.anything(),
      );
      expect(result.costLimitUsd).toBe(4.25);
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
      vi.mocked(projectsDao.getOne).mockResolvedValue(null);

      await expect(
        service.findById(
          new AppContextStorage({ sub: 'other-user' }, {
            headers: {},
          } as unknown as FastifyRequest),
          mockProjectId,
        ),
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
        expect.anything(),
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

  describe('prepareResponse (via findById)', () => {
    it('should project costLimitUsd as null when absent from settings', async () => {
      const entity = createMockProjectEntity({ settings: {} });
      vi.mocked(projectsDao.getOne).mockResolvedValue(entity);

      const result = await service.findById(mockCtx, mockProjectId);

      expect(result.costLimitUsd).toBeNull();
    });

    it('should project costLimitUsd from settings when present', async () => {
      const entity = createMockProjectEntity({
        settings: { costLimitUsd: 12.5 },
      });
      vi.mocked(projectsDao.getOne).mockResolvedValue(entity);

      const result = await service.findById(mockCtx, mockProjectId);

      expect(result.costLimitUsd).toBe(12.5);
    });
  });

  describe('update', () => {
    it('should update a project name', async () => {
      const dto: UpdateProjectDto = { name: 'Updated Name' };
      const existingEntity = createMockProjectEntity();
      const updatedEntity = createMockProjectEntity({ name: 'Updated Name' });

      vi.mocked(projectsDao.getOne)
        .mockResolvedValueOnce(existingEntity)
        .mockResolvedValueOnce(updatedEntity);
      vi.mocked(projectsDao.updateById).mockResolvedValue(1);

      const result = await service.update(mockCtx, mockProjectId, dto);

      expect(result.name).toBe('Updated Name');
    });

    it('should throw NotFoundException when project not found during update', async () => {
      vi.mocked(projectsDao.getOne).mockResolvedValue(null);

      await expect(
        service.update(mockCtx, mockProjectId, { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should persist costLimitUsd into settings.costLimitUsd', async () => {
      const existingEntity = createMockProjectEntity({ settings: {} });
      const updatedEntity = createMockProjectEntity({
        settings: { costLimitUsd: 9.99 },
      });

      vi.mocked(projectsDao.getOne)
        .mockResolvedValueOnce(existingEntity)
        .mockResolvedValueOnce(updatedEntity);
      vi.mocked(projectsDao.updateById).mockResolvedValue(1);

      const result = await service.update(mockCtx, mockProjectId, {
        costLimitUsd: 9.99,
      });

      expect(projectsDao.updateById).toHaveBeenCalledWith(
        mockProjectId,
        expect.objectContaining({
          settings: { costLimitUsd: 9.99 },
        }),
        expect.anything(),
      );
      expect(result.costLimitUsd).toBe(9.99);
    });

    it('should preserve settings.models when only costLimitUsd changes', async () => {
      const existingEntity = createMockProjectEntity({
        settings: { models: { llmLargeModel: 'big-model' } },
      });
      const updatedEntity = createMockProjectEntity({
        settings: {
          models: { llmLargeModel: 'big-model' },
          costLimitUsd: 3,
        },
      });

      vi.mocked(projectsDao.getOne)
        .mockResolvedValueOnce(existingEntity)
        .mockResolvedValueOnce(updatedEntity);
      vi.mocked(projectsDao.updateById).mockResolvedValue(1);

      await service.update(mockCtx, mockProjectId, { costLimitUsd: 3 });

      expect(projectsDao.updateById).toHaveBeenCalledWith(
        mockProjectId,
        expect.objectContaining({
          settings: {
            models: { llmLargeModel: 'big-model' },
            costLimitUsd: 3,
          },
        }),
        expect.anything(),
      );
    });

    it('should preserve settings.costLimitUsd when only settings.models changes', async () => {
      const existingEntity = createMockProjectEntity({
        settings: { costLimitUsd: 7 },
      });
      const updatedEntity = createMockProjectEntity({
        settings: {
          costLimitUsd: 7,
          models: { llmLargeModel: 'new-model' },
        },
      });

      vi.mocked(projectsDao.getOne)
        .mockResolvedValueOnce(existingEntity)
        .mockResolvedValueOnce(updatedEntity);
      vi.mocked(projectsDao.updateById).mockResolvedValue(1);

      await service.update(mockCtx, mockProjectId, {
        settings: { models: { llmLargeModel: 'new-model' } },
      });

      expect(projectsDao.updateById).toHaveBeenCalledWith(
        mockProjectId,
        expect.objectContaining({
          settings: {
            costLimitUsd: 7,
            models: { llmLargeModel: 'new-model' },
          },
        }),
        expect.anything(),
      );
    });

    it('should clear costLimitUsd when explicitly set to null', async () => {
      const existingEntity = createMockProjectEntity({
        settings: { costLimitUsd: 5, models: { llmLargeModel: 'm' } },
      });
      const updatedEntity = createMockProjectEntity({
        settings: { costLimitUsd: null, models: { llmLargeModel: 'm' } },
      });

      vi.mocked(projectsDao.getOne)
        .mockResolvedValueOnce(existingEntity)
        .mockResolvedValueOnce(updatedEntity);
      vi.mocked(projectsDao.updateById).mockResolvedValue(1);

      const result = await service.update(mockCtx, mockProjectId, {
        costLimitUsd: null,
      });

      expect(projectsDao.updateById).toHaveBeenCalledWith(
        mockProjectId,
        expect.objectContaining({
          settings: {
            costLimitUsd: null,
            models: { llmLargeModel: 'm' },
          },
        }),
        expect.anything(),
      );
      expect(result.costLimitUsd).toBeNull();
    });
  });

  describe('delete', () => {
    it('should emit PROJECT_DELETED_EVENT and soft-delete the project', async () => {
      const entity = createMockProjectEntity();
      vi.mocked(projectsDao.getOne).mockResolvedValue(entity);

      await service.delete(mockCtx, mockProjectId);

      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        PROJECT_DELETED_EVENT,
        expect.objectContaining({
          projectId: mockProjectId,
          userId: mockUserId,
        }),
      );
      expect(projectsDao.deleteById).toHaveBeenCalledWith(mockProjectId);
    });

    it('should throw NotFoundException when project not found during delete', async () => {
      vi.mocked(projectsDao.getOne).mockResolvedValue(null);

      await expect(service.delete(mockCtx, mockProjectId)).rejects.toThrow(
        NotFoundException,
      );

      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
      expect(projectsDao.deleteById).not.toHaveBeenCalled();
    });
  });
});
