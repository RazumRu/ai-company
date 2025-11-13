import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { environment } from '../../../environments';
import { GraphRevisionEntity } from '../entity/graph-revision.entity';

export interface GraphRevisionJobData {
  revisionId: string;
  graphId: string;
}

@Injectable()
export class GraphRevisionQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private queue!: Queue<GraphRevisionJobData>;
  private worker!: Worker<GraphRevisionJobData>;
  private redis!: IORedis;
  private processor?: (job: GraphRevisionJobData) => Promise<void>;

  constructor(private readonly logger: DefaultLogger) {}

  async onModuleInit(): Promise<void> {
    this.redis = new IORedis(environment.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue<GraphRevisionJobData>('graph-revisions', {
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

    this.worker = new Worker<GraphRevisionJobData>(
      'graph-revisions',
      this.processJob.bind(this),
      {
        connection: this.redis,
        concurrency: 1,
      },
    );

    this.worker.on('completed', (job: Job<GraphRevisionJobData>) => {
      this.logger.log(
        `Graph revision job ${job.id} completed for graph ${job.data.graphId}`,
      );
    });

    this.worker.on(
      'failed',
      (job: Job<GraphRevisionJobData> | undefined, err: Error) => {
        this.logger.error(
          err,
          `Graph revision job ${job?.id} failed for graph ${job?.data.graphId}`,
        );
      },
    );

    this.logger.log('Graph revision queue service initialized');
  }

  setProcessor(processor: (job: GraphRevisionJobData) => Promise<void>): void {
    this.processor = processor;
  }

  async addRevision(revision: GraphRevisionEntity): Promise<void> {
    await this.queue.add(
      'apply-revision',
      {
        revisionId: revision.id,
        graphId: revision.graphId,
      },
      {
        jobId: revision.id,
      },
    );

    this.logger.log(`Added graph revision ${revision.id} to queue`);
  }

  async getQueueStatus(graphId: string): Promise<{
    pending: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const jobs = await this.queue.getJobs([
      'waiting',
      'delayed',
      'active',
      'completed',
      'failed',
    ]);

    const graphJobs = jobs.filter((job) => job.data.graphId === graphId);

    const jobStates = await Promise.all(
      graphJobs.map(async (job) => ({
        state: await job.getState(),
      })),
    );

    const stateCounts = jobStates.reduce<Record<string, number>>((acc, job) => {
      acc[job.state] = (acc[job.state] ?? 0) + 1;
      return acc;
    }, {});

    const countStates = (...states: string[]) =>
      states.reduce((sum, state) => sum + (stateCounts[state] ?? 0), 0);

    return {
      pending: countStates('waiting', 'delayed'),
      active: countStates('active'),
      completed: countStates('completed'),
      failed: countStates('failed'),
    };
  }

  private async processJob(job: Job<GraphRevisionJobData>): Promise<void> {
    if (!this.processor) {
      throw new Error('Graph revision processor not set');
    }

    this.logger.log(
      `Processing graph revision job ${job.id} for graph ${job.data.graphId}`,
    );

    await this.processor(job.data);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await this.redis.quit();
  }
}
