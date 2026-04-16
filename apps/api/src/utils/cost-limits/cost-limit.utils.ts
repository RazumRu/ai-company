import type { CostLimitSettings } from './cost-limit-settings.schema';

interface ResolveEffectiveCostLimitInputs {
  graph?: CostLimitSettings | null;
  project?: CostLimitSettings | null;
  user?: CostLimitSettings | null;
}

const isActiveLimit = (value: number | null | undefined): value is number => {
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
};

export const resolveEffectiveCostLimit = (
  inputs: ResolveEffectiveCostLimitInputs,
): number | null => {
  const candidates: number[] = [];

  for (const source of [inputs.graph, inputs.project, inputs.user]) {
    if (source === null || source === undefined) {
      continue;
    }
    const value = source.costLimitUsd;
    if (isActiveLimit(value)) {
      candidates.push(value);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  return Math.min(...candidates);
};

export const isCostLimitExceeded = (
  currentCostUsd: number,
  effectiveLimitUsd: number | null,
): boolean => {
  if (effectiveLimitUsd === null) {
    return false;
  }
  return currentCostUsd >= effectiveLimitUsd;
};

export const extractCostLimit = (
  settings: Record<string, unknown> | null | undefined,
): CostLimitSettings | null => {
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
};
