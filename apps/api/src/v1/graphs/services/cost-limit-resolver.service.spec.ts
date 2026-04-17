import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectsDao } from '../../projects/dao/projects.dao';
import { UserPreferencesService } from '../../user-preferences/services/user-preferences.service';
import { GraphDao } from '../dao/graph.dao';
import { CostLimitResolverService } from './cost-limit-resolver.service';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_GRAPH_ID = '00000000-0000-0000-0000-000000000aaa';
const TEST_PROJECT_ID = '00000000-0000-0000-0000-000000000bbb';

const mockGraphDao = {
  getById: vi.fn(),
};

const mockProjectsDao = {
  getById: vi.fn(),
};

const mockUserPreferencesService = {
  getCostLimitForUser: vi.fn(),
};

describe('CostLimitResolverService', () => {
  let service: CostLimitResolverService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostLimitResolverService,
        { provide: GraphDao, useValue: mockGraphDao },
        { provide: ProjectsDao, useValue: mockProjectsDao },
        {
          provide: UserPreferencesService,
          useValue: mockUserPreferencesService,
        },
      ],
    }).compile();

    service = module.get<CostLimitResolverService>(CostLimitResolverService);
  });

  it('returns null when all three sources are null', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: {},
    });
    mockProjectsDao.getById.mockResolvedValue({ settings: {} });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBeNull();
  });

  it('returns the graph limit when only graph is set', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: { costLimitUsd: 0.5 },
    });
    mockProjectsDao.getById.mockResolvedValue({ settings: {} });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(0.5);
  });

  it('returns the project limit when only project is set', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: {},
    });
    mockProjectsDao.getById.mockResolvedValue({
      settings: { costLimitUsd: 1.25 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(1.25);
  });

  it('returns the user limit when only user preference is set', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: {},
    });
    mockProjectsDao.getById.mockResolvedValue({ settings: {} });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(3.5);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(3.5);
  });

  it('returns the strictest (smallest) non-zero limit when all three are present', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: { costLimitUsd: 5 },
    });
    mockProjectsDao.getById.mockResolvedValue({
      settings: { costLimitUsd: 2 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(10);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(2);
  });

  it('treats zero as unlimited and picks the remaining non-zero limit', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: { costLimitUsd: 0 },
    });
    mockProjectsDao.getById.mockResolvedValue({
      settings: { costLimitUsd: 2 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(2);
  });

  it('skips the project lookup when graph has no projectId', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: null,
      settings: { costLimitUsd: 1 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(1);
    expect(mockProjectsDao.getById).not.toHaveBeenCalled();
  });

  it('treats graph as null when graph is not found', async () => {
    mockGraphDao.getById.mockResolvedValue(null);
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(4);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(4);
    expect(mockProjectsDao.getById).not.toHaveBeenCalled();
  });

  it('treats user as null when the user preferences row is missing', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: {},
    });
    mockProjectsDao.getById.mockResolvedValue({
      settings: { costLimitUsd: 7 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(7);
  });

  it('treats NaN as no limit and picks the remaining value', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: { costLimitUsd: Number.NaN },
    });
    mockProjectsDao.getById.mockResolvedValue({
      settings: { costLimitUsd: 2 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(2);
  });

  it('treats Infinity as no limit and picks the remaining value', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: { costLimitUsd: Number.POSITIVE_INFINITY },
    });
    mockProjectsDao.getById.mockResolvedValue({
      settings: { costLimitUsd: 2 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(2);
  });

  it('treats negative numbers as no limit (defensive)', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: { costLimitUsd: -1 },
    });
    mockProjectsDao.getById.mockResolvedValue({
      settings: { costLimitUsd: 4 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(4);
  });

  it('treats non-numeric settings values as no limit', async () => {
    mockGraphDao.getById.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: { costLimitUsd: 'not-a-number' },
    });
    mockProjectsDao.getById.mockResolvedValue({
      settings: { costLimitUsd: 3 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(3);
  });
});
