import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AuthContextStorage,
  CtxStorage,
  OnlyForAuthorized,
} from '@packages/http-server';

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
    @CtxStorage() ctx: AuthContextStorage,
  ): Promise<AnalyticsOverviewDto> {
    return this.analyticsService.getOverview(ctx, query);
  }

  @Get('by-graph')
  async getByGraph(
    @Query() query: AnalyticsByGraphQueryDto,
    @CtxStorage() ctx: AuthContextStorage,
  ): Promise<AnalyticsByGraphResponseDto> {
    return this.analyticsService.getByGraph(ctx, query);
  }
}
