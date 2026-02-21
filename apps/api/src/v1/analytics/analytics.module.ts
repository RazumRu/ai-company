import { Module } from '@nestjs/common';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsDao } from './analytics.dao';
import { AnalyticsService } from './analytics.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsDao, AnalyticsService],
})
export class AnalyticsModule {}
