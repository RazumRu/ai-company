/**
 * Unit tests for the cost-limit banner logic in ThreadMessagesView.
 *
 * The banner is rendered when stopReason === 'cost_limit'. These tests
 * validate the condition and the USD formatting helper used in the banner.
 * Full component rendering is not covered here because the vitest environment
 * is 'node' (no DOM), matching the project's existing test pattern.
 *
 * shouldShowCostLimitBanner is imported directly from ThreadMessagesView so
 * these tests exercise the real production code — removing or changing the
 * 'cost_limit' check in that file will cause these tests to fail.
 */

import { describe, expect, it } from 'vitest';

import { formatUsd } from '../../chats/utils/chatsPageUtils';
import { shouldShowCostLimitBanner } from './ThreadMessagesView';

describe('cost-limit banner visibility', () => {
  it('shows banner when stopReason is "cost_limit"', () => {
    expect(shouldShowCostLimitBanner('cost_limit')).toBe(true);
  });

  it('does not show banner when stopReason is undefined', () => {
    expect(shouldShowCostLimitBanner(undefined)).toBe(false);
  });

  it('does not show banner when stopReason is null', () => {
    expect(shouldShowCostLimitBanner(null)).toBe(false);
  });

  it('does not show banner when stopReason is an empty string', () => {
    expect(shouldShowCostLimitBanner('')).toBe(false);
  });

  it('does not show banner when stopReason is "user_stop"', () => {
    expect(shouldShowCostLimitBanner('user_stop')).toBe(false);
  });

  it('does not show banner when stopReason is "error"', () => {
    expect(shouldShowCostLimitBanner('error')).toBe(false);
  });

  it('condition is case-sensitive — does not match "Cost_Limit"', () => {
    expect(shouldShowCostLimitBanner('Cost_Limit')).toBe(false);
  });
});

// ─── Banner cost formatting ───────────────────────────────────────────────────

describe('cost-limit banner USD formatting', () => {
  it('formats a whole-dollar amount correctly', () => {
    expect(formatUsd(1)).toBe('$1.00');
  });

  it('formats a fractional amount correctly', () => {
    expect(formatUsd(0.5)).toBe('$0.50');
  });

  it('formats zero correctly', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('returns a sub-cent placeholder for very small amounts', () => {
    expect(formatUsd(0.001)).toBe('<$0.01');
  });

  it('returns a dash placeholder for null stopCostUsd', () => {
    expect(formatUsd(null)).toBe('$\u2014');
  });

  it('returns a dash placeholder for undefined stopCostUsd', () => {
    expect(formatUsd(undefined)).toBe('$\u2014');
  });
});
