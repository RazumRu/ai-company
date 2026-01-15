import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { environment } from '../../../environments';
import { RuntimeProvider } from './runtime-provider';

@Injectable()
export class RuntimeCleanupService implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue;
  private worker!: Worker;
  private redis!: IORedis;
  private readonly queueName = `runtime-cleanup-${environment.env}`;

  constructor(private readonly runtimeProvider: RuntimeProvider) {}

  async onModuleInit(): Promise<void> {
    this.redis = new IORedis(environment.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue(this.queueName, {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 25,
        removeOnFail: 25,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    });

    this.worker = new Worker(this.queueName, this.processJob.bind(this), {
      connection: this.redis,
      concurrency: 1,
    });

    await this.queue.add(
      'cleanup',
      {},
      {
        repeat: { every: environment.runtimeCleanupIntervalMs },
      },
    );

    await this.runtimeProvider.cleanupTemporaryRuntimes();
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    await this.redis?.quit();
  }

  private async processJob(_job: Job): Promise<void> {
    const idleThresholdMs = environment.runtimeIdleThresholdMs;
    await this.runtimeProvider.cleanupIdleRuntimes(idleThresholdMs);
    await this.runtimeProvider.cleanupTemporaryRuntimes();
  }
}
