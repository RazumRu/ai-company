import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OnlyForAuthorized } from '@packages/http-server';

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
  ): Promise<AnalyticsOverviewDto> {
    return this.analyticsService.getOverview(query);
  }

  @Get('by-graph')
  async getByGraph(
    @Query() query: AnalyticsByGraphQueryDto,
  ): Promise<AnalyticsByGraphResponseDto> {
    return this.analyticsService.getByGraph(query);
  }
}
