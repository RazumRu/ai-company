import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

import { environment } from '../../../environments';

export interface RepoIndexJobData {
  repoIndexId: string;
  repoUrl: string;
}

export interface RepoIndexQueueCallbacks {
  /** Called to process the job */
  onProcess: (data: RepoIndexJobData) => Promise<void>;
  /** Called when a job is detected as stalled (server died mid-processing) */
  onStalled: (repoIndexId: string) => Promise<void>;
  /** Called when a job fails after all retries */
  onFailed: (repoIndexId: string, error: Error) => Promise<void>;
}

@Injectable()
export class RepoIndexQueueService implements OnModuleInit, OnModuleDestroy {
  private queue!: Queue<RepoIndexJobData>;
  private worker!: Worker<RepoIndexJobData>;
  private redis!: IORedis;
  private callbacks?: RepoIndexQueueCallbacks;
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
        // Repository indexing can take several minutes for large repos
        lockDuration: 10 * 60 * 1000, // 10 minutes
        // Stalled job detection: checks every 30 seconds, retries up to 2 times
        stalledInterval: 30_000,
        maxStalledCount: 2,
      },
    );

    this.worker.on('failed', this.handleJobFailed.bind(this));
    this.worker.on('stalled', this.handleJobStalled.bind(this));
  }

  /**
   * Register callbacks for job lifecycle events.
   * Must be called before any jobs are processed.
   */
  setCallbacks(callbacks: RepoIndexQueueCallbacks): void {
    this.callbacks = callbacks;
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

  private async processJob(job: Job<RepoIndexJobData>): Promise<void> {
    if (!this.callbacks) {
      throw new Error('Queue callbacks not configured');
    }
    await this.callbacks.onProcess(job.data);
  }

  private async handleJobStalled(jobId: string): Promise<void> {
    this.logger.warn('Repo index job stalled, will be retried', { jobId });

    if (this.callbacks) {
      try {
        await this.callbacks.onStalled(jobId);
      } catch (err) {
        this.logger.error(
          err instanceof Error ? err : new Error(String(err)),
          'Failed to handle stalled job',
          { jobId },
        );
      }
    }
  }

  private async handleJobFailed(
    job: Job<RepoIndexJobData> | undefined,
    err: Error,
  ): Promise<void> {
    if (!job) return;

    this.logger.error(err, 'Repo index job failed', {
      jobId: job.id,
      repoIndexId: job.data.repoIndexId,
      attemptsMade: job.attemptsMade,
    });

    // Only notify callback on final failure (all retries exhausted)
    if (this.callbacks && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      try {
        await this.callbacks.onFailed(job.data.repoIndexId, err);
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
  }

  async onModuleDestroy(): Promise<void> {
    // Force close immediately - leaves active jobs in place for stalled detection on restart
    await this.worker.close(true);
    await this.queue.close();
    await this.redis.quit();
  }
}
