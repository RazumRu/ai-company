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
  private redisQueue!: IORedis;
  private redisWorker!: IORedis;
  private processor?: (job: GraphRevisionJobData) => Promise<void>;
  private readonly queueName = `graph-revisions-${environment.env}`;

  constructor(private readonly logger: DefaultLogger) {}

  async onModuleInit(): Promise<void> {
    this.redisQueue = new IORedis(environment.redisUrl, {
      maxRetriesPerRequest: null,
    });
    this.redisWorker = new IORedis(environment.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.redisQueue.on('error', (err) => {
      this.logger.error(err, 'Redis queue connection error');
    });
    this.redisWorker.on('error', (err) => {
      this.logger.error(err, 'Redis worker connection error');
    });

    this.queue = new Queue<GraphRevisionJobData>(this.queueName, {
      connection: this.redisQueue,
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
        connection: this.redisWorker,
        concurrency: 5,
        // Graph revision processing can take time for complex graphs
        // Set lock duration to 5 minutes to prevent premature stall detection
        lockDuration: 5 * 60 * 1000, // 5 minutes in milliseconds
      },
    );

    this.worker.on('failed', this.handleJobFailure.bind(this));
  }

  /**
   * Register the processor callback for revision jobs.
   * The Worker is already running by the time this is called (NestJS constructs
   * all providers before invoking onModuleInit hooks), so the processor must be
   * set before any job can be dequeued and handed off.
   * Must be called exactly once during module initialization.
   */
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
    try {
      await this.worker.close();
    } catch (err) {
      this.logger.warn('Failed to close BullMQ worker', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await this.queue.close();
    } catch (err) {
      this.logger.warn('Failed to close BullMQ queue', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    for (const [name, conn] of [
      ['queue', this.redisQueue],
      ['worker', this.redisWorker],
    ] as const) {
      try {
        await conn?.quit();
      } catch (err) {
        this.logger.warn(`Failed to close Redis ${name} connection`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
