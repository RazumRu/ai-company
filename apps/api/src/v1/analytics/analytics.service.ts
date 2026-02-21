import { Injectable } from '@nestjs/common';
import { AuthContextService } from '@packages/http-server';

import { AnalyticsDao } from './analytics.dao';
import type {
  AnalyticsByGraphQueryDto,
  AnalyticsByGraphResponseDto,
  AnalyticsOverviewDto,
  AnalyticsQueryDto,
  TokenAggregateRawRow,
} from './dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly analyticsDao: AnalyticsDao,
    private readonly authContext: AuthContextService,
  ) {}

  async getOverview(query: AnalyticsQueryDto): Promise<AnalyticsOverviewDto> {
    const userId = this.authContext.checkSub();

    const params = {
      createdBy: userId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    };

    const [threadCount, tokenRow] = await Promise.all([
      this.analyticsDao.countThreads(params),
      this.analyticsDao.getTokenAggregates(params),
    ]);

    return {
      totalThreads: threadCount,
      ...this.parseTokenRow(tokenRow),
    };
  }

  async getByGraph(
    query: AnalyticsByGraphQueryDto,
  ): Promise<AnalyticsByGraphResponseDto> {
    const userId = this.authContext.checkSub();

    const rows = await this.analyticsDao.getByGraph({
      createdBy: userId,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      graphId: query.graphId,
    });

    return {
      graphs: rows.map((row) => ({
        graphId: row.graphId,
        graphName: row.graphName,
        totalThreads: parseInt(row.totalThreads, 10),
        ...this.parseTokenRow(row),
      })),
    };
  }

  private parseTokenRow(row: TokenAggregateRawRow) {
    return {
      inputTokens: parseFloat(row.inputTokens),
      cachedInputTokens: parseFloat(row.cachedInputTokens),
      outputTokens: parseFloat(row.outputTokens),
      reasoningTokens: parseFloat(row.reasoningTokens),
      totalTokens: parseFloat(row.totalTokens),
      totalPrice: parseFloat(row.totalPrice),
    };
  }
}
