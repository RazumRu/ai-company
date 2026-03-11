import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CtxStorage, OnlyForAuthorized } from '@packages/http-server';

import { AppContextStorage } from '../../auth/app-context-storage';
import { AnalyticsService } from './analytics.service';
import {
  AnalyticsByGraphQueryDto,
  AnalyticsByGraphResponseDto,
  AnalyticsOverviewDto,
  AnalyticsQueryDto,
} from './dto/analytics.dto';

@ApiTags('analytics')
@Controller('analytics')
@ApiBearerAuth()
@OnlyForAuthorized()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async getOverview(
    @Query() query: AnalyticsQueryDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<AnalyticsOverviewDto> {
    return this.analyticsService.getOverview(ctx, query);
  }

  @Get('by-graph')
  async getByGraph(
    @Query() query: AnalyticsByGraphQueryDto,
    @CtxStorage() ctx: AppContextStorage,
  ): Promise<AnalyticsByGraphResponseDto> {
    return this.analyticsService.getByGraph(ctx, query);
  }
}
