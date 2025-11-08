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
  private processor?: (revision: GraphRevisionEntity) => Promise<void>;

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
        concurrency: 1, // Only one revision at a time per graph
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

  /**
   * Set the processor function that will handle the actual revision logic
   */
  setProcessor(
    processor: (revision: GraphRevisionEntity) => Promise<void>,
  ): void {
    this.processor = processor;
  }

  /**
   * Add a graph update to the queue
   * Uses unique jobId to ensure FIFO ordering per graph
   */
  async addRevision(revision: GraphRevisionEntity): Promise<void> {
    await this.queue.add(
      'apply-revision',
      {
        revisionId: revision.id,
        graphId: revision.graphId,
      },
      {
        jobId: revision.id,
        // Process jobs for the same graph sequentially
        // BullMQ will process jobs in the order they are added
      },
    );

    this.logger.log(`Added graph revision ${revision.id} to queue`);
  }

  /**
   * Get queue status for a specific graph
   */
  async getQueueStatus(graphId: string): Promise<{
    pending: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const jobs = await this.queue.getJobs([
      'waiting',
      'active',
      'completed',
      'failed',
    ]);

    const graphJobs = jobs.filter((job) => job.data.graphId === graphId);

    return {
      pending: graphJobs.filter((j) =>
        j.getState().then((s) => s === 'waiting'),
      ).length,
      active: graphJobs.filter((j) => j.getState().then((s) => s === 'active'))
        .length,
      completed: graphJobs.filter((j) =>
        j.getState().then((s) => s === 'completed'),
      ).length,
      failed: graphJobs.filter((j) => j.getState().then((s) => s === 'failed'))
        .length,
    };
  }

  private async processJob(job: Job<GraphRevisionJobData>): Promise<void> {
    if (!this.processor) {
      throw new Error('Graph revision processor not set');
    }

    this.logger.log(
      `Processing graph revision job ${job.id} for graph ${job.data.graphId}`,
    );

    // The processor will load the revision entity and apply it
    // We pass a minimal job data to avoid storing large objects in Redis
    await this.processor({
      id: job.data.revisionId,
      graphId: job.data.graphId,
    } as GraphRevisionEntity);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    await this.redis.quit();
  }
}
