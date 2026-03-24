import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebhookSyncStateDao } from '../dao/webhook-sync-state.dao';
import {
  PollableWebhookSubscriber,
  WebhookSubscriberType,
} from '../webhooks.types';
import { PollableWebhookRegistry } from './pollable-webhook-registry.service';

function createMockDao(): WebhookSyncStateDao {
  return {
    getLastSyncDate: vi.fn().mockResolvedValue(null),
    upsertLastSyncDate: vi.fn().mockResolvedValue(undefined),
  } as unknown as WebhookSyncStateDao;
}

interface TestPayload {
  id: string;
  value: string;
}

function createTestSubscriber(
  overrides: Partial<PollableWebhookSubscriber<TestPayload>> = {},
): PollableWebhookSubscriber<TestPayload> {
  return {
    subscriberKey: WebhookSubscriberType.GhIssue,
    pollFn: vi.fn().mockResolvedValue([]),
    onEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('PollableWebhookRegistry', () => {
  let registry: PollableWebhookRegistry;
  let dao: WebhookSyncStateDao;

  beforeEach(() => {
    vi.useFakeTimers();
    dao = createMockDao();
    registry = new PollableWebhookRegistry(dao);
    registry.onModuleInit();
  });

  afterEach(() => {
    registry.onModuleDestroy();
    vi.useRealTimers();
  });

  it('reconciliation fires: pollFn results are dispatched via onEvent', async () => {
    const payload: TestPayload = { id: 'poll-1', value: 'polled' };
    const subscriber = createTestSubscriber({
      pollFn: vi.fn().mockResolvedValue([payload]),
    });

    registry.register(subscriber);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(subscriber.pollFn).toHaveBeenCalledTimes(1);
    expect(subscriber.onEvent).toHaveBeenCalledTimes(1);
    expect(subscriber.onEvent).toHaveBeenCalledWith(payload);
    expect(dao.upsertLastSyncDate).toHaveBeenCalledWith(
      WebhookSubscriberType.GhIssue,
      expect.any(Date),
    );
  });

  it('uses stored lastSyncDate from DAO as since argument', async () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    (dao.getLastSyncDate as ReturnType<typeof vi.fn>).mockResolvedValue(
      thirtyMinAgo,
    );

    const subscriber = createTestSubscriber({
      pollFn: vi.fn().mockResolvedValue([]),
    });

    registry.register(subscriber);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(subscriber.pollFn).toHaveBeenCalledTimes(1);
    const sinceArg = (subscriber.pollFn as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Date;
    expect(sinceArg).toEqual(thirtyMinAgo);
  });

  it('cold start: uses now when DAO returns null', async () => {
    (dao.getLastSyncDate as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const subscriber = createTestSubscriber({
      pollFn: vi.fn().mockResolvedValue([]),
    });

    registry.register(subscriber);

    const beforeAdvance = Date.now();
    await vi.advanceTimersByTimeAsync(60_000);
    const afterAdvance = Date.now();

    const sinceArg = (subscriber.pollFn as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Date;
    expect(sinceArg.getTime()).toBeGreaterThanOrEqual(beforeAdvance);
    expect(sinceArg.getTime()).toBeLessThanOrEqual(afterAdvance);
  });

  it('upserts lastSyncDate to now after successful poll', async () => {
    const subscriber = createTestSubscriber();
    registry.register(subscriber);

    const beforeAdvance = Date.now();
    await vi.advanceTimersByTimeAsync(60_000);
    const afterAdvance = Date.now();

    expect(dao.upsertLastSyncDate).toHaveBeenCalledTimes(1);
    const upsertCall = (dao.upsertLastSyncDate as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(upsertCall[0]).toBe(WebhookSubscriberType.GhIssue);
    const savedDate = upsertCall[1] as Date;
    expect(savedDate.getTime()).toBeGreaterThanOrEqual(beforeAdvance);
    expect(savedDate.getTime()).toBeLessThanOrEqual(afterAdvance);
  });

  it('does not upsert lastSyncDate when pollFn throws', async () => {
    const subscriber = createTestSubscriber({
      pollFn: vi.fn().mockRejectedValue(new Error('network error')),
    });

    registry.register(subscriber);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(dao.upsertLastSyncDate).not.toHaveBeenCalled();
  });

  it('pollFn error does not crash timer: second cycle succeeds', async () => {
    const payload: TestPayload = { id: 'recover-1', value: 'data' };
    const pollFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce([payload]);

    const subscriber = createTestSubscriber({ pollFn });
    registry.register(subscriber);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(subscriber.onEvent).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(subscriber.onEvent).toHaveBeenCalledTimes(1);
    expect(subscriber.onEvent).toHaveBeenCalledWith(payload);
  });

  it('multiple subscribers are each reconciled independently', async () => {
    const payloadA: TestPayload = { id: 'a-1', value: 'a' };
    const payloadB: TestPayload = { id: 'b-1', value: 'b' };

    // Cast test-only keys that are not in the enum — registry behavior is key-agnostic
    const subscriberA = createTestSubscriber({
      subscriberKey: 'sub:a' as WebhookSubscriberType,
      pollFn: vi.fn().mockResolvedValue([payloadA]),
    });
    const subscriberB = createTestSubscriber({
      subscriberKey: 'sub:b' as WebhookSubscriberType,
      pollFn: vi.fn().mockResolvedValue([payloadB]),
    });

    registry.register(subscriberA);
    registry.register(subscriberB);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(subscriberA.onEvent).toHaveBeenCalledWith(payloadA);
    expect(subscriberB.onEvent).toHaveBeenCalledWith(payloadB);
    expect(dao.upsertLastSyncDate).toHaveBeenCalledWith(
      'sub:a',
      expect.any(Date),
    );
    expect(dao.upsertLastSyncDate).toHaveBeenCalledWith(
      'sub:b',
      expect.any(Date),
    );
  });

  it('unregistered subscriber is not polled on next cycle', async () => {
    const subscriber = createTestSubscriber({
      pollFn: vi.fn().mockResolvedValue([]),
    });

    registry.register(subscriber);
    registry.unregister(WebhookSubscriberType.GhIssue);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(subscriber.pollFn).not.toHaveBeenCalled();
  });

  it('interval is cleared on onModuleDestroy', async () => {
    const subscriber = createTestSubscriber({
      pollFn: vi.fn().mockResolvedValue([]),
    });

    registry.register(subscriber);
    registry.onModuleDestroy();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(subscriber.pollFn).not.toHaveBeenCalled();
  });

  it('reads WEBHOOK_POLL_INTERVAL_MS from env for interval', async () => {
    registry.onModuleDestroy();

    process.env.WEBHOOK_POLL_INTERVAL_MS = '30000';
    const customRegistry = new PollableWebhookRegistry(dao);
    customRegistry.onModuleInit();

    const subscriber = createTestSubscriber({
      pollFn: vi.fn().mockResolvedValue([]),
    });
    customRegistry.register(subscriber);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(subscriber.pollFn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(subscriber.pollFn).toHaveBeenCalledTimes(1);

    customRegistry.onModuleDestroy();
    delete process.env.WEBHOOK_POLL_INTERVAL_MS;
  });
});
