import { MikroORM, RequestContext } from '@mikro-orm/postgresql';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { environment, getInstanceFingerprint } from '../../../environments';

export interface RepoIndexJobData {
  repoIndexId: string;
  repoUrl: string;
  branch: string;
}

export interface RepoIndexQueueCallbacks {
  /** Called to process the job */
  onProcess: (data: RepoIndexJobData, signal?: AbortSignal) => Promise<void>;
  /** Called when a job is detected as stalled (server died mid-processing) */
  onStalled: (repoIndexId: string) => Promise<void>;
  /** Called when a job fails but will be retried */
  onRetry: (repoIndexId: string, error: Error) => Promise<void>;
  /** Called when a job fails after all retries */
  onFailed: (repoIndexId: string, error: Error) => Promise<void>;
}

/**
 * BullMQ-based job queue for background repository indexing.
 *
 * Creates its own IORedis connection rather than sharing with CacheService.
 * BullMQ requires `maxRetriesPerRequest: null` for blocking BRPOPLPUSH commands,
 * and the Worker needs a dedicated connection to avoid head-of-line blocking.
 * This matches the pattern used by GraphRevisionQueueService.
 */
@Injectable()
export class RepoIndexQueueService implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue<RepoIndexJobData>;
  private worker!: Worker<RepoIndexJobData>;
  private redisQueue!: IORedis;
  private redisWorker!: IORedis;
  private redisSub!: IORedis;
  private callbacks?: RepoIndexQueueCallbacks;
  private readonly queueName = `repo-index-${getInstanceFingerprint()}`;
  private readonly cancelChannel = `repo-index-cancel:${getInstanceFingerprint()}`;

  constructor(
    private readonly logger: DefaultLogger,
    private readonly orm: MikroORM,
  ) {}

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

    this.redisSub = new IORedis(environment.redisUrl, {
      maxRetriesPerRequest: null,
    });
    this.redisSub.on('error', (err) => {
      this.logger.error(err, 'Redis subscriber connection error');
    });

    this.queue = new Queue<RepoIndexJobData>(this.queueName, {
      connection: this.redisQueue,
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 2000 },
      },
    });

    // Worker is created in setCallbacks() to guarantee callbacks are ready
    // before any job is processed.
  }

  /**
   * Register callbacks for job lifecycle events and start the worker.
   * Must be called exactly once during module initialization.
   */
  setCallbacks(callbacks: RepoIndexQueueCallbacks): void {
    this.callbacks = callbacks;

    // Create the worker only after callbacks are registered so no job can
    // be processed before the handlers are in place.
    this.worker = new Worker<RepoIndexJobData>(
      this.queueName,
      this.processJob.bind(this),
      {
        connection: this.redisWorker,
        concurrency: 2,
        // Repository indexing can take several minutes for large repos
        lockDuration: 10 * 60 * 1000, // 10 minutes
        // Stalled job detection: checks every 30 seconds, retries up to 2 times
        stalledInterval: 30_000,
        maxStalledCount: 2,
      },
    );

    this.worker.on('failed', this.handleJobFailed.bind(this));
    this.worker.on('stalled', this.handleJobStalled.bind(this));

    this.redisSub.subscribe(this.cancelChannel).catch((err) => {
      this.logger.warn('Failed to subscribe to cancel channel', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    this.redisSub.on('message', (_channel: string, jobId: string) => {
      this.worker.cancelJob(jobId, 'Repository deleted');
    });
  }

  /**
   * Remove all stale active jobs from the queue. Call on startup before
   * re-adding recovery jobs to avoid race conditions with stalled detection.
   */
  async cleanStaleActiveJobs(): Promise<void> {
    try {
      const cleaned = await this.queue.clean(0, 100, 'active');
      if (cleaned.length > 0) {
        this.logger.debug('Cleaned stale active jobs from queue', {
          count: cleaned.length,
        });
      }
    } catch (err) {
      this.logger.warn('Failed to clean stale active jobs', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Add a job to the queue. If a job with the same ID already exists:
   * - If waiting/delayed: skip (already queued)
   * - If active: try to move to failed (orphaned from previous server), then re-add
   * - If completed/failed: remove and re-add
   */
  async addIndexJob(data: RepoIndexJobData): Promise<void> {
    const existingJob = await this.queue.getJob(data.repoIndexId);

    if (existingJob) {
      const state = await existingJob.getState();

      if (state === 'waiting' || state === 'delayed') {
        this.logger.debug('Job already in queue, skipping', {
          repoIndexId: data.repoIndexId,
          state,
        });
        return;
      }

      // For active/completed/failed jobs, try to remove so we can re-add
      try {
        if (state === 'active') {
          // Job is "active" but we're at startup, so it's orphaned from previous server
          // Move to failed first, then remove
          await existingJob.moveToFailed(
            new Error('Job orphaned after server restart'),
            '0',
            false,
          );
        }
        await existingJob.remove();
        this.logger.debug('Removed existing job', {
          repoIndexId: data.repoIndexId,
          previousState: state,
        });
      } catch (err) {
        // If removal fails (e.g., job is locked), log and continue
        this.logger.debug(
          'Could not remove existing job, will try to add anyway',
          {
            repoIndexId: data.repoIndexId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }

    await this.queue.add('index-repo', data, { jobId: data.repoIndexId });
    this.logger.debug('Repo index job added to queue', {
      repoIndexId: data.repoIndexId,
    });
  }

  /**
   * Cancel an active job on any worker instance.
   * Uses native BullMQ signal cancellation locally and Redis pub/sub for remote workers.
   */
  async cancelActiveJob(repoIndexId: string): Promise<void> {
    const cancelledLocally = this.worker.cancelJob(
      repoIndexId,
      'Repository deleted',
    );

    if (!cancelledLocally) {
      // Job might be on another instance — broadcast via Redis pub/sub
      try {
        const client = await this.queue.client;
        await client.publish(this.cancelChannel, repoIndexId);
      } catch (err) {
        this.logger.debug('Failed to publish cancel event', {
          repoIndexId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  /**
   * Remove a job from the queue by its ID. For active jobs, uses native
   * BullMQ signal cancellation. Best-effort: if the job is already
   * gone or cancellation races with completion, we warn and continue.
   */
  async removeJob(repoIndexId: string): Promise<void> {
    try {
      const job = await this.queue.getJob(repoIndexId);
      if (!job) {
        return;
      }

      const state = await job.getState();

      if (state === 'active') {
        this.logger.warn(
          'Cancelling active repo index job due to repository deletion',
          { repoIndexId },
        );
        await this.cancelActiveJob(repoIndexId);
        return;
      }

      await job.remove();
      this.logger.debug('Removed queued job', { repoIndexId, state });
    } catch (err) {
      this.logger.debug('Could not remove job from queue', {
        repoIndexId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async processJob(
    job: Job<RepoIndexJobData>,
    _token?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.callbacks) {
      throw new Error('Queue callbacks not configured');
    }
    // Fork the EM for the job so identity-map state doesn't leak between
    // jobs or into the global EM. See GraphRevisionQueueService for the
    // full rationale.
    await RequestContext.create(this.orm.em, async () => {
      await this.callbacks!.onProcess(job.data, signal);
    });
  }

  private async handleJobStalled(jobId: string): Promise<void> {
    this.logger.warn('Repo index job stalled, will be retried', { jobId });

    if (!this.callbacks) {
      return;
    }

    try {
      // Resolve repoIndexId from job data rather than relying on the
      // implicit jobId === repoIndexId coupling set in addIndexJob.
      const job = await this.queue.getJob(jobId);
      const repoIndexId = job?.data?.repoIndexId ?? jobId;
      await this.callbacks.onStalled(repoIndexId);
    } catch (err) {
      this.logger.error(
        err instanceof Error ? err : new Error(String(err)),
        'Failed to handle stalled job',
        { jobId },
      );
    }
  }

  private async handleJobFailed(
    job: Job<RepoIndexJobData> | undefined,
    err: Error,
  ): Promise<void> {
    if (!job) {
      return;
    }

    this.logger.error(err, 'Repo index job failed', {
      jobId: job.id,
      repoIndexId: job.data.repoIndexId,
      attemptsMade: job.attemptsMade,
    });

    if (!this.callbacks) {
      return;
    }

    const isFinalFailure = job.attemptsMade >= (job.opts.attempts ?? 1);

    try {
      if (isFinalFailure) {
        await this.callbacks.onFailed(job.data.repoIndexId, err);
      } else {
        // Reset entity to Pending so it doesn't appear stuck as InProgress
        // while BullMQ waits to retry
        await this.callbacks.onRetry(job.data.repoIndexId, err);
      }
    } catch (callbackErr) {
      this.logger.error(
        callbackErr instanceof Error
          ? callbackErr
          : new Error(String(callbackErr)),
        'Failed to handle job failure callback',
        { jobId: job.id },
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    // Close each resource in its own try/catch to ensure all resources are
    // cleaned up even if one fails. Worker may not exist if setCallbacks
    // was never called (e.g. partial startup).
    if (this.worker) {
      try {
        await this.worker.close();
      } catch (err) {
        this.logger.warn('Failed to close BullMQ worker', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    try {
      await this.queue?.close();
    } catch (err) {
      this.logger.warn('Failed to close BullMQ queue', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    for (const [name, conn] of [
      ['queue', this.redisQueue],
      ['worker', this.redisWorker],
      ['subscriber', this.redisSub],
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
