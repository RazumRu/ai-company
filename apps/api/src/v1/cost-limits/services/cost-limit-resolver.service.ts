import { Injectable } from '@nestjs/common';

import {
  extractCostLimit,
  resolveEffectiveCostLimit,
} from '../../../utils/cost-limits/cost-limit.utils';
import type { CostLimitSettings } from '../../../utils/cost-limits/cost-limit-settings.schema';
import { UserPreferencesService } from '../../user-preferences/services/user-preferences.service';
import { CostLimitsDao } from '../dao/cost-limits.dao';

@Injectable()
export class CostLimitResolverService {
  constructor(
    private readonly costLimitsDao: CostLimitsDao,
    private readonly userPreferencesService: UserPreferencesService,
  ) {}

  async resolveForThread(
    userId: string,
    graphId: string,
  ): Promise<number | null> {
    const graph = await this.costLimitsDao.getGraphCostLimitRow(graphId);

    const graphSettings = extractCostLimit(graph?.settings);

    let projectSettings: CostLimitSettings | null = null;
    if (graph?.projectId) {
      const project = await this.costLimitsDao.getProjectCostLimitRow(
        graph.projectId,
      );
      projectSettings = extractCostLimit(project?.settings);
    }

    const userCostLimit =
      await this.userPreferencesService.getCostLimitForUser(userId);
    const userSettings: CostLimitSettings | null =
      userCostLimit === null ? null : { costLimitUsd: userCostLimit };

    return resolveEffectiveCostLimit({
      graph: graphSettings,
      project: projectSettings,
      user: userSettings,
    });
  }
}
