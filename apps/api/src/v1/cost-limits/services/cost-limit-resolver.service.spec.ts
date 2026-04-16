import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UserPreferencesService } from '../../user-preferences/services/user-preferences.service';
import { CostLimitsDao } from '../dao/cost-limits.dao';
import { CostLimitResolverService } from './cost-limit-resolver.service';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_GRAPH_ID = '00000000-0000-0000-0000-000000000aaa';
const TEST_PROJECT_ID = '00000000-0000-0000-0000-000000000bbb';

const mockDao = {
  getGraphCostLimitRow: vi.fn(),
  getProjectCostLimitRow: vi.fn(),
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
        { provide: CostLimitsDao, useValue: mockDao },
        {
          provide: UserPreferencesService,
          useValue: mockUserPreferencesService,
        },
      ],
    }).compile();

    service = module.get<CostLimitResolverService>(CostLimitResolverService);
  });

  it('returns null when all three sources are null', async () => {
    mockDao.getGraphCostLimitRow.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: {},
    });
    mockDao.getProjectCostLimitRow.mockResolvedValue({
      settings: {},
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBeNull();
  });

  it('returns the graph limit when only graph is set', async () => {
    mockDao.getGraphCostLimitRow.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: { costLimitUsd: 0.5 },
    });
    mockDao.getProjectCostLimitRow.mockResolvedValue({
      settings: {},
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(0.5);
  });

  it('returns the project limit when only project is set', async () => {
    mockDao.getGraphCostLimitRow.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: {},
    });
    mockDao.getProjectCostLimitRow.mockResolvedValue({
      settings: { costLimitUsd: 1.25 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(1.25);
  });

  it('returns the user limit when only user preference is set', async () => {
    mockDao.getGraphCostLimitRow.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: {},
    });
    mockDao.getProjectCostLimitRow.mockResolvedValue({
      settings: {},
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(3.5);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(3.5);
  });

  it('returns the strictest (smallest) non-zero limit when all three are present', async () => {
    mockDao.getGraphCostLimitRow.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: { costLimitUsd: 5 },
    });
    mockDao.getProjectCostLimitRow.mockResolvedValue({
      settings: { costLimitUsd: 2 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(10);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(2);
  });

  it('treats zero as unlimited and picks the remaining non-zero limit', async () => {
    mockDao.getGraphCostLimitRow.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: { costLimitUsd: 0 },
    });
    mockDao.getProjectCostLimitRow.mockResolvedValue({
      settings: { costLimitUsd: 2 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(2);
  });

  it('skips the project lookup when graph has no projectId', async () => {
    mockDao.getGraphCostLimitRow.mockResolvedValue({
      projectId: null,
      settings: { costLimitUsd: 1 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(1);
    expect(mockDao.getProjectCostLimitRow).not.toHaveBeenCalled();
  });

  it('treats graph as null when graph is not found', async () => {
    mockDao.getGraphCostLimitRow.mockResolvedValue(null);
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(4);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(4);
    expect(mockDao.getProjectCostLimitRow).not.toHaveBeenCalled();
  });

  it('treats user as null when the user preferences row is missing', async () => {
    mockDao.getGraphCostLimitRow.mockResolvedValue({
      projectId: TEST_PROJECT_ID,
      settings: {},
    });
    mockDao.getProjectCostLimitRow.mockResolvedValue({
      settings: { costLimitUsd: 7 },
    });
    mockUserPreferencesService.getCostLimitForUser.mockResolvedValue(null);

    const result = await service.resolveForThread(TEST_USER_ID, TEST_GRAPH_ID);

    expect(result).toBe(7);
  });
});
