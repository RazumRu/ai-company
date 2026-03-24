import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as envModule from '../../../environments';
import { WebhookProcessedEventDao } from '../dao/webhook-processed-event.dao';
import { WebhookSyncStateDao } from '../dao/webhook-sync-state.dao';
import {
  PollableWebhookSubscriber,
  WebhookSubscriberType,
} from '../webhooks.types';
import { PollableWebhookRegistry } from './pollable-webhook-registry.service';

vi.mock('../../../environments', () => ({
  environment: { webhookPollIntervalMs: 60_000 },
}));

function createMockSyncDao(): WebhookSyncStateDao {
  return {
    getLastSyncDate: vi.fn().mockResolvedValue(null),
    upsertLastSyncDate: vi.fn().mockResolvedValue(undefined),
  } as unknown as WebhookSyncStateDao;
}

function createMockProcessedDao(): WebhookProcessedEventDao {
  return {
    exists: vi.fn().mockResolvedValue(false),
    markProcessed: vi.fn().mockResolvedValue(undefined),
  } as unknown as WebhookProcessedEventDao;
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
    getDeduplicationKey: (payload: TestPayload) => payload.id,
    onEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('PollableWebhookRegistry', () => {
  let registry: PollableWebhookRegistry;
  let syncDao: WebhookSyncStateDao;
  let processedDao: WebhookProcessedEventDao;

  beforeEach(() => {
    vi.useFakeTimers();
    syncDao = createMockSyncDao();
    processedDao = createMockProcessedDao();
    registry = new PollableWebhookRegistry(syncDao, processedDao);
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
    expect(syncDao.upsertLastSyncDate).toHaveBeenCalledWith(
      WebhookSubscriberType.GhIssue,
      expect.any(Date),
    );
  });

  it('uses stored lastSyncDate from DAO as since argument', async () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    (syncDao.getLastSyncDate as ReturnType<typeof vi.fn>).mockResolvedValue(
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
    (syncDao.getLastSyncDate as ReturnType<typeof vi.fn>).mockResolvedValue(
      null,
    );

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

    expect(syncDao.upsertLastSyncDate).toHaveBeenCalledTimes(1);
    const upsertCall = (syncDao.upsertLastSyncDate as ReturnType<typeof vi.fn>)
      .mock.calls[0]!;
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

    expect(syncDao.upsertLastSyncDate).not.toHaveBeenCalled();
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
    expect(syncDao.upsertLastSyncDate).toHaveBeenCalledWith(
      'sub:a',
      expect.any(Date),
    );
    expect(syncDao.upsertLastSyncDate).toHaveBeenCalledWith(
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

  it('uses webhookPollIntervalMs from environment config', async () => {
    registry.onModuleDestroy();

    (
      envModule as { environment: { webhookPollIntervalMs: number } }
    ).environment.webhookPollIntervalMs = 30_000;
    const customRegistry = new PollableWebhookRegistry(syncDao, processedDao);
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
    (
      envModule as { environment: { webhookPollIntervalMs: number } }
    ).environment.webhookPollIntervalMs = 60_000;
  });
});
