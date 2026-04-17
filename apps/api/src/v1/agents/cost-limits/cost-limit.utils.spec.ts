import { describe, expect, it } from 'vitest';

import {
  isCostLimitExceeded,
  resolveEffectiveCostLimit,
} from './cost-limit.utils';

describe('resolveEffectiveCostLimit', () => {
  it('returns null when all sources are null', () => {
    const result = resolveEffectiveCostLimit({
      graph: { costLimitUsd: null },
      project: { costLimitUsd: null },
      user: { costLimitUsd: null },
    });
    expect(result).toBeNull();
  });

  it('returns null when all sources are undefined', () => {
    const result = resolveEffectiveCostLimit({});
    expect(result).toBeNull();
  });

  it('returns graph-only value when only graph has a limit', () => {
    const result = resolveEffectiveCostLimit({
      graph: { costLimitUsd: 0.5 },
      project: { costLimitUsd: null },
      user: { costLimitUsd: null },
    });
    expect(result).toBe(0.5);
  });

  it('returns project-only value when only project has a limit', () => {
    const result = resolveEffectiveCostLimit({
      graph: { costLimitUsd: null },
      project: { costLimitUsd: 5 },
      user: { costLimitUsd: null },
    });
    expect(result).toBe(5);
  });

  it('returns user-only value when only user has a limit', () => {
    const result = resolveEffectiveCostLimit({
      graph: { costLimitUsd: null },
      project: { costLimitUsd: null },
      user: { costLimitUsd: 1 },
    });
    expect(result).toBe(1);
  });

  it('returns graph when graph is stricter than project and user', () => {
    const result = resolveEffectiveCostLimit({
      graph: { costLimitUsd: 0.5 },
      project: { costLimitUsd: 5 },
      user: { costLimitUsd: 2 },
    });
    expect(result).toBe(0.5);
  });

  it('returns user when user is stricter than graph and project', () => {
    const result = resolveEffectiveCostLimit({
      graph: { costLimitUsd: 5 },
      project: { costLimitUsd: 2 },
      user: { costLimitUsd: 10 },
    });
    expect(result).toBe(2);
  });

  it('returns user when user is strictest and graph is null', () => {
    const result = resolveEffectiveCostLimit({
      graph: { costLimitUsd: null },
      project: { costLimitUsd: 5 },
      user: { costLimitUsd: 1 },
    });
    expect(result).toBe(1);
  });

  it('treats zero as null (graph=0, project=2, user=null) -> 2', () => {
    const result = resolveEffectiveCostLimit({
      graph: { costLimitUsd: 0 },
      project: { costLimitUsd: 2 },
      user: { costLimitUsd: null },
    });
    expect(result).toBe(2);
  });

  it('treats NaN as null (graph=NaN, project=2) -> 2', () => {
    const result = resolveEffectiveCostLimit({
      graph: { costLimitUsd: Number.NaN },
      project: { costLimitUsd: 2 },
    });
    expect(result).toBe(2);
  });

  it('treats Infinity as null (graph=Infinity, project=2) -> 2', () => {
    const result = resolveEffectiveCostLimit({
      graph: { costLimitUsd: Number.POSITIVE_INFINITY },
      project: { costLimitUsd: 2 },
    });
    expect(result).toBe(2);
  });

  it('treats a missing object (undefined) as null', () => {
    const result = resolveEffectiveCostLimit({
      graph: undefined,
      project: { costLimitUsd: 3 },
      user: undefined,
    });
    expect(result).toBe(3);
  });

  it('treats a null object (null) as null', () => {
    const result = resolveEffectiveCostLimit({
      graph: null,
      project: { costLimitUsd: 3 },
      user: null,
    });
    expect(result).toBe(3);
  });

  it('treats negative numbers as no limit (defensive)', () => {
    const result = resolveEffectiveCostLimit({
      graph: { costLimitUsd: -1 },
      project: { costLimitUsd: 4 },
      user: { costLimitUsd: null },
    });
    expect(result).toBe(4);
  });
});

describe('isCostLimitExceeded', () => {
  it('returns false when the effective limit is null', () => {
    expect(isCostLimitExceeded(100, null)).toBe(false);
  });

  it('returns false when current cost is below the limit', () => {
    expect(isCostLimitExceeded(0.5, 1)).toBe(false);
  });

  it('returns true when current cost equals the limit', () => {
    expect(isCostLimitExceeded(1, 1)).toBe(true);
  });

  it('returns true when current cost is above the limit', () => {
    expect(isCostLimitExceeded(2, 1)).toBe(true);
  });
});
