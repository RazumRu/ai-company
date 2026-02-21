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
  private readonly queueName = `graph-revisions-${environment.env}`;

  constructor(private readonly logger: DefaultLogger) {}

  async onModuleInit(): Promise<void> {
    this.redis = new IORedis(environment.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue<GraphRevisionJobData>(this.queueName, {
      connection: this.redis,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 2000 },
      },
    });

    this.worker = new Worker<GraphRevisionJobData>(
      this.queueName,
      this.processJob.bind(this),
      {
        connection: this.redis,
        concurrency: 5,
        // Graph revision processing can take time for complex graphs
        // Set lock duration to 5 minutes to prevent premature stall detection
        lockDuration: 5 * 60 * 1000, // 5 minutes in milliseconds
      },
    );

    this.worker.on('failed', this.handleJobFailure.bind(this));
  }

  setProcessor(processor: (job: GraphRevisionJobData) => Promise<void>): void {
    this.processor = processor;
  }

  async addRevision(
    revision: Pick<GraphRevisionEntity, 'id' | 'graphId'>,
  ): Promise<void> {
    await this.queue.add(
      'apply-revision',
      { revisionId: revision.id, graphId: revision.graphId },
      { jobId: revision.id },
    );
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

    await this.processor(job.data);
  }

  private handleJobFailure(
    job: Job<GraphRevisionJobData> | undefined,
    err: Error,
  ): void {
    this.logger.error(
      err,
      `Graph revision job ${job?.id} failed for graph ${job?.data.graphId}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();

    try {
      if (this.redis.status === 'ready') {
        await this.redis.quit();
      }
    } catch {
      // Redis connection may already be closed by worker/queue teardown
    }
  }
}
