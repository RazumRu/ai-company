import { Injectable } from '@nestjs/common';

import type { CostLimitSettings } from '../../agents/cost-limits/cost-limit-settings.schema';
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

    const graphSettings = this.extractCostLimit(graph?.settings);

    let projectSettings: CostLimitSettings | null = null;
    if (graph?.projectId) {
      const project = await this.costLimitsDao.getProjectCostLimitRow(
        graph.projectId,
      );
      projectSettings = this.extractCostLimit(project?.settings);
    }

    const userCostLimit =
      await this.userPreferencesService.getCostLimitForUser(userId);
    const userSettings: CostLimitSettings | null =
      userCostLimit === null ? null : { costLimitUsd: userCostLimit };

    return this.pickStrictest([graphSettings, projectSettings, userSettings]);
  }

  private extractCostLimit(
    settings: Record<string, unknown> | null | undefined,
  ): CostLimitSettings | null {
    if (!settings) {
      return null;
    }
    const value = settings['costLimitUsd'];
    if (value === null || value === undefined) {
      return { costLimitUsd: null };
    }
    if (typeof value !== 'number') {
      return { costLimitUsd: null };
    }
    return { costLimitUsd: value };
  }

  private pickStrictest(
    sources: (CostLimitSettings | null | undefined)[],
  ): number | null {
    const candidates: number[] = [];

    for (const source of sources) {
      if (source === null || source === undefined) {
        continue;
      }
      const value = source.costLimitUsd;
      if (this.isActiveLimit(value)) {
        candidates.push(value);
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    return Math.min(...candidates);
  }

  private isActiveLimit(value: number | null | undefined): value is number {
    if (value === null || value === undefined) {
      return false;
    }
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return false;
    }
    if (value <= 0) {
      return false;
    }
    return true;
  }
}
