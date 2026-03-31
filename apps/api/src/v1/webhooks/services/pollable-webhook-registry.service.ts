import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { environment } from '../../../environments';
import { WebhookProcessedEventDao } from '../dao/webhook-processed-event.dao';
import { WebhookSyncStateDao } from '../dao/webhook-sync-state.dao';
import {
  type PollableWebhookSubscriber,
  type WebhookSubscriberType,
} from '../webhooks.types';

@Injectable()
export class PollableWebhookRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PollableWebhookRegistry.name);
  private readonly subscribers = new Map<
    WebhookSubscriberType,
    PollableWebhookSubscriber<unknown>
  >();
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    private readonly webhookSyncStateDao: WebhookSyncStateDao,
    private readonly webhookProcessedEventDao: WebhookProcessedEventDao,
  ) {}

  onModuleInit(): void {
    this.intervalHandle = setInterval(() => {
      void this.reconcileAll();
    }, environment.webhookPollIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  register<T>(subscriber: PollableWebhookSubscriber<T>): void {
    this.subscribers.set(
      subscriber.subscriberKey,
      subscriber as PollableWebhookSubscriber<unknown>,
    );
  }

  unregister(subscriberKey: WebhookSubscriberType): void {
    this.subscribers.delete(subscriberKey);
  }

  private async reconcileAll(): Promise<void> {
    for (const subscriber of this.subscribers.values()) {
      await this.reconcileSubscriber(subscriber);
    }
  }

  private async reconcileSubscriber(
    subscriber: PollableWebhookSubscriber<unknown>,
  ): Promise<void> {
    try {
      const lastSyncDate = await this.webhookSyncStateDao.getLastSyncDate(
        subscriber.subscriberKey,
      );
      const since = lastSyncDate ?? new Date();

      const events = await subscriber.pollFn(since);

      const now = new Date();
      for (const event of events) {
        const dedupKey = subscriber.getDeduplicationKey(event);

        if (dedupKey !== null) {
          const alreadyProcessed =
            await this.webhookProcessedEventDao.exists(dedupKey);
          if (alreadyProcessed) {
            continue;
          }
        }

        await subscriber.onEvent(event);

        if (dedupKey !== null) {
          await this.webhookProcessedEventDao.markProcessed(dedupKey);
        }
      }

      await this.webhookSyncStateDao.upsertLastSyncDate(
        subscriber.subscriberKey,
        now,
      );
    } catch (error) {
      this.logger.error(
        `Error reconciling subscriber ${subscriber.subscriberKey}`,
        error,
      );
    }
  }
}
