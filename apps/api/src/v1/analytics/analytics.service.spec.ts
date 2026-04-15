import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { AppContextStorage } from '../../auth/app-context-storage';
import { AnalyticsDao } from './analytics.dao';
import { AnalyticsService } from './analytics.service';
import type { ByGraphRawRow, TokenAggregateRawRow } from './dto/analytics.dto';

describe('AnalyticsService', () => {
  const userId = 'user-123';
  const projectId = 'project-abc';

  let service: AnalyticsService;
  let dao: ReturnType<typeof mock<AnalyticsDao>>;

  const mockCtx = {
    checkSub: vi.fn().mockReturnValue(userId),
    checkProjectId: vi.fn().mockReturnValue(projectId),
  } as unknown as AppContextStorage;

  beforeEach(() => {
    dao = mock<AnalyticsDao>();

    service = new AnalyticsService(dao);
  });

  describe('getOverview', () => {
    const rawRow: TokenAggregateRawRow = {
      inputTokens: '800000',
      cachedInputTokens: '50000',
      outputTokens: '400000',
      reasoningTokens: '1000',
      totalTokens: '1251000',
      totalPrice: '12.85',
    };

    it('should return aggregated overview', async () => {
      dao.countThreads.mockResolvedValue(42);
      dao.getTokenAggregates.mockResolvedValue(rawRow);

      const result = await service.getOverview(mockCtx, {});

      expect(mockCtx.checkSub).toHaveBeenCalled();
      expect(mockCtx.checkProjectId).toHaveBeenCalled();
      expect(dao.countThreads).toHaveBeenCalledWith({
        createdBy: userId,
        projectId,
        dateFrom: undefined,
        dateTo: undefined,
      });
      expect(dao.getTokenAggregates).toHaveBeenCalledWith({
        createdBy: userId,
        projectId,
        dateFrom: undefined,
        dateTo: undefined,
      });

      expect(result).toEqual({
        totalThreads: 42,
        inputTokens: 800000,
        cachedInputTokens: 50000,
        outputTokens: 400000,
        reasoningTokens: 1000,
        totalTokens: 1251000,
        totalPrice: 12.85,
      });
    });

    it('should pass date range params to DAO', async () => {
      dao.countThreads.mockResolvedValue(10);
      dao.getTokenAggregates.mockResolvedValue(rawRow);

      const dateFrom = '2025-01-01T00:00:00Z';
      const dateTo = '2025-06-01T00:00:00Z';

      await service.getOverview(mockCtx, { dateFrom, dateTo });

      expect(dao.countThreads).toHaveBeenCalledWith({
        createdBy: userId,
        projectId,
        dateFrom,
        dateTo,
      });
      expect(dao.getTokenAggregates).toHaveBeenCalledWith({
        createdBy: userId,
        projectId,
        dateFrom,
        dateTo,
      });
    });

    it('should call checkProjectId and forward projectId to DAO', async () => {
      dao.countThreads.mockResolvedValue(0);
      dao.getTokenAggregates.mockResolvedValue(rawRow);

      await service.getOverview(mockCtx, {});

      expect(mockCtx.checkProjectId).toHaveBeenCalled();
      expect(dao.countThreads).toHaveBeenCalledWith(
        expect.objectContaining({ projectId }),
      );
      expect(dao.getTokenAggregates).toHaveBeenCalledWith(
        expect.objectContaining({ projectId }),
      );
    });

    it('should handle zero results', async () => {
      const zeroRow: TokenAggregateRawRow = {
        inputTokens: '0',
        cachedInputTokens: '0',
        outputTokens: '0',
        reasoningTokens: '0',
        totalTokens: '0',
        totalPrice: '0',
      };

      dao.countThreads.mockResolvedValue(0);
      dao.getTokenAggregates.mockResolvedValue(zeroRow);

      const result = await service.getOverview(mockCtx, {});

      expect(result).toEqual({
        totalThreads: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        totalPrice: 0,
      });
    });
  });

  describe('getByGraph', () => {
    it('should return per-graph breakdown', async () => {
      const rows: ByGraphRawRow[] = [
        {
          graphId: 'graph-1',
          graphName: 'Agent A',
          inputTokens: '400000',
          cachedInputTokens: '20000',
          outputTokens: '180000',
          reasoningTokens: '0',
          totalTokens: '600000',
          totalPrice: '6.50',
        },
        {
          graphId: 'graph-2',
          graphName: 'Agent B',
          inputTokens: '100000',
          cachedInputTokens: '0',
          outputTokens: '50000',
          reasoningTokens: '500',
          totalTokens: '150500',
          totalPrice: '1.20',
        },
      ];

      dao.getByGraph.mockResolvedValue(rows);
      dao.countThreadsByGraph.mockResolvedValue(
        new Map([
          ['graph-1', 20],
          ['graph-2', 5],
        ]),
      );

      const result = await service.getByGraph(mockCtx, {});

      expect(mockCtx.checkSub).toHaveBeenCalled();
      expect(mockCtx.checkProjectId).toHaveBeenCalled();
      expect(dao.getByGraph).toHaveBeenCalledWith({
        createdBy: userId,
        projectId,
        dateFrom: undefined,
        dateTo: undefined,
        graphId: undefined,
      });
      expect(dao.countThreadsByGraph).toHaveBeenCalledWith(
        {
          createdBy: userId,
          projectId,
          dateFrom: undefined,
          dateTo: undefined,
        },
        ['graph-1', 'graph-2'],
      );

      expect(result.graphs).toHaveLength(2);
      expect(result.graphs[0]).toEqual({
        graphId: 'graph-1',
        graphName: 'Agent A',
        totalThreads: 20,
        inputTokens: 400000,
        cachedInputTokens: 20000,
        outputTokens: 180000,
        reasoningTokens: 0,
        totalTokens: 600000,
        totalPrice: 6.5,
      });
      expect(result.graphs[1]).toEqual({
        graphId: 'graph-2',
        graphName: 'Agent B',
        totalThreads: 5,
        inputTokens: 100000,
        cachedInputTokens: 0,
        outputTokens: 50000,
        reasoningTokens: 500,
        totalTokens: 150500,
        totalPrice: 1.2,
      });
    });

    it('should pass graphId filter to DAO', async () => {
      dao.getByGraph.mockResolvedValue([]);
      dao.countThreadsByGraph.mockResolvedValue(new Map());

      const graphId = 'graph-abc';
      await service.getByGraph(mockCtx, { graphId });

      expect(dao.getByGraph).toHaveBeenCalledWith({
        createdBy: userId,
        projectId,
        dateFrom: undefined,
        dateTo: undefined,
        graphId,
      });
    });

    it('should call checkProjectId and forward projectId to DAO', async () => {
      dao.getByGraph.mockResolvedValue([]);
      dao.countThreadsByGraph.mockResolvedValue(new Map());

      await service.getByGraph(mockCtx, {});

      expect(mockCtx.checkProjectId).toHaveBeenCalled();
      expect(dao.getByGraph).toHaveBeenCalledWith(
        expect.objectContaining({ projectId }),
      );
      expect(dao.countThreadsByGraph).toHaveBeenCalledWith(
        expect.objectContaining({ projectId }),
        [],
      );
    });

    it('should return empty array when no graphs have data', async () => {
      dao.getByGraph.mockResolvedValue([]);
      dao.countThreadsByGraph.mockResolvedValue(new Map());

      const result = await service.getByGraph(mockCtx, {});

      expect(result.graphs).toEqual([]);
    });

    it('should default totalThreads to 0 for graphs missing from thread count map', async () => {
      const rows: ByGraphRawRow[] = [
        {
          graphId: 'graph-orphan',
          graphName: 'Orphan Graph',
          inputTokens: '50',
          cachedInputTokens: '0',
          outputTokens: '25',
          reasoningTokens: '0',
          totalTokens: '75',
          totalPrice: '0.01',
        },
      ];

      dao.getByGraph.mockResolvedValue(rows);
      // countThreadsByGraph returns an empty map (no threads counted)
      dao.countThreadsByGraph.mockResolvedValue(new Map());

      const result = await service.getByGraph(mockCtx, {});

      expect(result.graphs[0]!.totalThreads).toBe(0);
    });
  });
});
