import { AuthContextStorage } from '@packages/http-server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { AnalyticsDao } from './analytics.dao';
import { AnalyticsService } from './analytics.service';
import type { ByGraphRawRow, TokenAggregateRawRow } from './dto/analytics.dto';

describe('AnalyticsService', () => {
  const userId = 'user-123';

  let service: AnalyticsService;
  let dao: ReturnType<typeof mock<AnalyticsDao>>;

  const mockCtx = {
    checkSub: vi.fn().mockReturnValue(userId),
  } as unknown as AuthContextStorage;

  beforeEach(() => {
    dao = mock<AnalyticsDao>();

    service = new AnalyticsService(dao);
  });

  describe('getOverview', () => {
    const rawRow: TokenAggregateRawRow = {
      totalThreads: '0',
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
      expect(dao.countThreads).toHaveBeenCalledWith({
        createdBy: userId,
        dateFrom: undefined,
        dateTo: undefined,
      });
      expect(dao.getTokenAggregates).toHaveBeenCalledWith({
        createdBy: userId,
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
        dateFrom,
        dateTo,
      });
      expect(dao.getTokenAggregates).toHaveBeenCalledWith({
        createdBy: userId,
        dateFrom,
        dateTo,
      });
    });

    it('should handle zero results', async () => {
      const zeroRow: TokenAggregateRawRow = {
        totalThreads: '0',
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
          totalThreads: '20',
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
          totalThreads: '5',
          inputTokens: '100000',
          cachedInputTokens: '0',
          outputTokens: '50000',
          reasoningTokens: '500',
          totalTokens: '150500',
          totalPrice: '1.20',
        },
      ];

      dao.getByGraph.mockResolvedValue(rows);

      const result = await service.getByGraph(mockCtx, {});

      expect(mockCtx.checkSub).toHaveBeenCalled();
      expect(dao.getByGraph).toHaveBeenCalledWith({
        createdBy: userId,
        dateFrom: undefined,
        dateTo: undefined,
        graphId: undefined,
      });

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
    });

    it('should pass graphId filter to DAO', async () => {
      dao.getByGraph.mockResolvedValue([]);

      const graphId = 'graph-abc';
      await service.getByGraph(mockCtx, { graphId });

      expect(dao.getByGraph).toHaveBeenCalledWith({
        createdBy: userId,
        dateFrom: undefined,
        dateTo: undefined,
        graphId,
      });
    });

    it('should return empty array when no graphs have data', async () => {
      dao.getByGraph.mockResolvedValue([]);

      const result = await service.getByGraph(mockCtx, {});

      expect(result.graphs).toEqual([]);
    });
  });
});
