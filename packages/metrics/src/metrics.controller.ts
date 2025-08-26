import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { MetricsService } from './services/metrics.service';

@Controller({
  path: 'metrics',
  version: VERSION_NEUTRAL,
})
@ApiTags('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({
    description: 'Get prom metric',
  })
  public async getMetrics(): Promise<string> {
    return this.metricsService.getAll();
  }
}
