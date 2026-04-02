import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { environment } from '../../../environments';

export interface ThreadResumeJobData {
  threadId: string;
  graphId: string;
  nodeId: string;
  externalThreadId: string;
  checkPrompt: string;
  reason: string;
  scheduledAt: string;
  createdBy: string;
}

export interface ThreadResumeQueueCallbacks {
  /** Called to process the resume job */
  onProcess: (data: ThreadResumeJobData) => Promise<void>;
  /** Called when a resume job fails after all retries */
  onFailed: (data: ThreadResumeJobData, error: Error) => Promise<void>;
}

/**
 * BullMQ-based job queue for delayed thread resume jobs.
 *
 * Creates its own IORedis connections rather than sharing with CacheService.
 * BullMQ requires `maxRetriesPerRequest: null` for blocking BRPOPLPUSH commands,
 * and the Worker needs a dedicated connection to avoid head-of-line blocking.
 * This matches the pattern used by RepoIndexQueueService.
 */
@Injectable()
export class ThreadResumeQueueService implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue<ThreadResumeJobData>;
  private worker!: Worker<ThreadResumeJobData>;
  private redisQueue!: IORedis;
  private redisWorker!: IORedis;
  private callbacks?: ThreadResumeQueueCallbacks;
  private readonly queueName = `thread-resume-${environment.env}`;

  constructor(private readonly logger: DefaultLogger) {}

  async onModuleInit(): Promise<void> {
    this.redisQueue = new IORedis(environment.redisUrl, {
      maxRetriesPerRequest: null,
    });
    this.redisWorker = new IORedis(environment.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.redisQueue.on('error', (err) => {
      this.logger.error(err, 'Thread resume queue Redis connection error');
    });
    this.redisWorker.on('error', (err) => {
      this.logger.error(err, 'Thread resume worker Redis connection error');
    });

    this.queue = new Queue<ThreadResumeJobData>(this.queueName, {
      connection: this.redisQueue,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 5000 },
      },
    });
  }

  /**
   * Register callbacks for job lifecycle events and start the worker.
   * Must be called exactly once during module initialization.
   */
  setCallbacks(callbacks: ThreadResumeQueueCallbacks): void {
    this.callbacks = callbacks;

    this.worker = new Worker<ThreadResumeJobData>(
      this.queueName,
      this.processJob.bind(this),
      {
        connection: this.redisWorker,
        concurrency: 5,
        lockDuration: 300_000, // 5 minutes
      },
    );

    this.worker.on('failed', this.handleJobFailed.bind(this));
  }

  /**
   * Schedule a delayed resume job for a thread.
   * The job will be processed after the specified delay.
   */
  async scheduleResume(
    data: ThreadResumeJobData,
    delayMs: number,
  ): Promise<void> {
    const jobId = `thread-resume:${data.threadId}`;

    // Remove any existing job for this thread before scheduling a new one
    const existingJob = await this.queue.getJob(jobId);
    if (existingJob) {
      try {
        await existingJob.remove();
        this.logger.debug('Removed existing resume job before rescheduling', {
          threadId: data.threadId,
        });
      } catch (err) {
        this.logger.debug('Could not remove existing resume job', {
          threadId: data.threadId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await this.queue.add('thread-resume', data, {
      jobId,
      delay: delayMs,
    });

    this.logger.debug('Thread resume job scheduled', {
      threadId: data.threadId,
      graphId: data.graphId,
      delayMs,
    });
  }

  /**
   * Cancel a pending resume job for a specific thread.
   * Best-effort: if the job is already processing or gone, we log and continue.
   */
  async cancelResumeJob(threadId: string): Promise<void> {
    const jobId = `thread-resume:${threadId}`;
    try {
      const job = await this.queue.getJob(jobId);
      if (!job) {
        return;
      }
      await job.remove();
      this.logger.debug('Cancelled resume job', { threadId });
    } catch (err) {
      this.logger.debug('Could not cancel resume job', {
        threadId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Cancel all pending resume jobs for a specific graph.
   * Iterates delayed jobs and removes those matching the graphId.
   */
  async cancelAllForGraph(graphId: string): Promise<void> {
    try {
      const delayedJobs = await this.queue.getDelayed();
      const matchingJobs = delayedJobs.filter(
        (job) => job.data.graphId === graphId,
      );

      if (matchingJobs.length === 0) {
        return;
      }

      await Promise.allSettled(
        matchingJobs.map(async (job) => {
          try {
            await job.remove();
          } catch (err) {
            this.logger.debug('Could not remove delayed resume job', {
              jobId: job.id,
              graphId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }),
      );

      this.logger.debug('Cancelled resume jobs for graph', {
        graphId,
        count: matchingJobs.length,
      });
    } catch (err) {
      this.logger.warn('Failed to cancel resume jobs for graph', {
        graphId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async processJob(job: Job<ThreadResumeJobData>): Promise<void> {
    if (!this.callbacks) {
      throw new Error('Queue callbacks not configured');
    }
    await this.callbacks.onProcess(job.data);
  }

  private async handleJobFailed(
    job: Job<ThreadResumeJobData> | undefined,
    err: Error,
  ): Promise<void> {
    if (!job) {
      return;
    }

    this.logger.error(err, 'Thread resume job failed', {
      jobId: job.id,
      threadId: job.data.threadId,
      attemptsMade: job.attemptsMade,
    });

    if (!this.callbacks) {
      return;
    }

    const isFinalFailure = job.attemptsMade >= (job.opts.attempts ?? 1);

    if (isFinalFailure) {
      try {
        await this.callbacks.onFailed(job.data, err);
      } catch (callbackErr) {
        this.logger.error(
          callbackErr instanceof Error
            ? callbackErr
            : new Error(String(callbackErr)),
          'Failed to handle resume job failure callback',
          { jobId: job.id },
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      try {
        await this.worker.close();
      } catch (err) {
        this.logger.warn('Failed to close BullMQ resume worker', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    try {
      await this.queue?.close();
    } catch (err) {
      this.logger.warn('Failed to close BullMQ resume queue', {
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
