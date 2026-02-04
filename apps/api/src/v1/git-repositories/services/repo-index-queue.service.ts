import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { environment } from '../../../environments';

export interface RepoIndexJobData {
  repoIndexId: string;
  repoUrl: string;
}

@Injectable()
export class RepoIndexQueueService implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue<RepoIndexJobData>;
  private worker!: Worker<RepoIndexJobData>;
  private redis!: IORedis;
  private processor?: (job: RepoIndexJobData) => Promise<void>;
  private readonly queueName = `repo-index-${environment.env}`;

  constructor(private readonly logger: DefaultLogger) {}

  async onModuleInit(): Promise<void> {
    this.redis = new IORedis(environment.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue<RepoIndexJobData>(this.queueName, {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 2000 },
      },
    });

    this.worker = new Worker<RepoIndexJobData>(
      this.queueName,
      this.processJob.bind(this),
      {
        connection: this.redis,
        concurrency: 2,
      },
    );

    this.worker.on('failed', this.handleJobFailure.bind(this));
  }

  setProcessor(processor: (job: RepoIndexJobData) => Promise<void>): void {
    this.processor = processor;
  }

  async addIndexJob(data: RepoIndexJobData): Promise<void> {
    await this.queue.add('index-repo', data, { jobId: data.repoIndexId });
  }

  private async processJob(job: Job<RepoIndexJobData>): Promise<void> {
    if (!this.processor) {
      throw new Error('Repo index processor not set');
    }
    await this.processor(job.data);
  }

  private handleJobFailure(
    job: Job<RepoIndexJobData> | undefined,
    err: Error,
  ): void {
    this.logger.error(
      err,
      `Repo index job ${job?.id} failed for index ${job?.data.repoIndexId}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await this.redis.quit();
  }
}
