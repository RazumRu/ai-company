import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { environment } from '../../../environments';
import { Notification } from '../notifications.types';

@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private queue: Queue<Notification>;
  private worker: Worker<Notification>;

  private redis: IORedis;
  private subscribers: ((notification: Notification) => Promise<void>)[] = [];
  private readonly queueName = `notifications-${environment.env}`;

  constructor(private readonly logger: DefaultLogger) {
    this.redis = new IORedis(environment.redisUrl, {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue(this.queueName, {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    this.worker = new Worker<Notification>(
      this.queueName,
      this.processJob.bind(this),
      {
        connection: this.redis,
        concurrency: 1,
      },
    );
  }

  private async processJob(job: Job<Notification>): Promise<void> {
    const notification = job.data;

    // Notify all subscribers
    await Promise.all(
      this.subscribers.map(async (subscriber) => {
        try {
          await subscriber(notification);
        } catch (error) {
          this.logger.error(
            <Error>error,
            'Subscriber failed to process notification',
            {
              jobId: job.id,
              type: notification.type,
              graphId: notification.graphId,
            },
          );
          // Don't rethrow - let other subscribers continue
        }
      }),
    );
  }

  emit(event: Notification) {
    return this.queue.add('process-notification', event);
  }

  subscribe(cb: (event: Notification) => Promise<void>) {
    this.subscribers.push(cb);
  }

  async onModuleDestroy() {
    await this.queue.close();
    await this.redis.quit();
    await this.worker.close(true);
  }
}
