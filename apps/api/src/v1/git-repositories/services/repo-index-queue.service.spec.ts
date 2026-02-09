import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RepoIndexJobData,
  RepoIndexQueueCallbacks,
  RepoIndexQueueService,
} from './repo-index-queue.service';

const mockQueue = {
  add: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  getJob: vi.fn().mockResolvedValue(null),
};

const mockWorker = {
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockRedis = {
  quit: vi.fn().mockResolvedValue(undefined),
};

const mockLogger = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

vi.mock('bullmq', () => ({
  Queue: function Queue() {
    return mockQueue;
  },
  Worker: function Worker() {
    return mockWorker;
  },
}));

vi.mock('ioredis', () => {
  return {
    default: function IORedis() {
      return mockRedis;
    },
  };
});

describe('RepoIndexQueueService', () => {
  let service: RepoIndexQueueService;

  beforeEach(async () => {
    vi.clearAllMocks();
    service = new RepoIndexQueueService(mockLogger as unknown as DefaultLogger);
    await service.onModuleInit();
  });

  describe('setCallbacks', () => {
    it('stores the callbacks and creates worker', () => {
      const callbacks: RepoIndexQueueCallbacks = {
        onProcess: vi.fn(),
        onStalled: vi.fn(),
        onRetry: vi.fn(),
        onFailed: vi.fn(),
      };
      service.setCallbacks(callbacks);
      // Callbacks are stored privately; verified via event handling behavior
      expect(callbacks.onProcess).not.toHaveBeenCalled();
      // Worker is created when setCallbacks is called
      expect(mockWorker.on).toHaveBeenCalled();
    });
  });

  describe('addIndexJob', () => {
    it('adds a job with repoIndexId as jobId', async () => {
      const data: RepoIndexJobData = {
        repoIndexId: 'test-id-123',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
      };

      await service.addIndexJob(data);

      expect(mockQueue.add).toHaveBeenCalledWith('index-repo', data, {
        jobId: 'test-id-123',
      });
    });

    it('skips adding when existing job is in waiting state', async () => {
      const data: RepoIndexJobData = {
        repoIndexId: 'waiting-job-id',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
      };

      mockQueue.getJob.mockResolvedValueOnce({
        getState: vi.fn().mockResolvedValue('waiting'),
        remove: vi.fn(),
        moveToFailed: vi.fn(),
      });

      await service.addIndexJob(data);

      expect(mockQueue.add).not.toHaveBeenCalled();
    });

    it('moves to failed and re-adds when existing job is in active state', async () => {
      const data: RepoIndexJobData = {
        repoIndexId: 'active-job-id',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
      };

      const mockExistingJob = {
        getState: vi.fn().mockResolvedValue('active'),
        remove: vi.fn().mockResolvedValue(undefined),
        moveToFailed: vi.fn().mockResolvedValue(undefined),
      };

      mockQueue.getJob.mockResolvedValueOnce(mockExistingJob);

      await service.addIndexJob(data);

      expect(mockExistingJob.moveToFailed).toHaveBeenCalledWith(
        expect.any(Error),
        '0',
        false,
      );
      expect(mockExistingJob.remove).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledWith('index-repo', data, {
        jobId: 'active-job-id',
      });
    });

    it('removes and re-adds when existing job is in completed state', async () => {
      const data: RepoIndexJobData = {
        repoIndexId: 'completed-job-id',
        repoUrl: 'https://github.com/owner/repo',
        branch: 'main',
      };

      const mockExistingJob = {
        getState: vi.fn().mockResolvedValue('completed'),
        remove: vi.fn().mockResolvedValue(undefined),
        moveToFailed: vi.fn(),
      };

      mockQueue.getJob.mockResolvedValueOnce(mockExistingJob);

      await service.addIndexJob(data);

      expect(mockExistingJob.moveToFailed).not.toHaveBeenCalled();
      expect(mockExistingJob.remove).toHaveBeenCalled();
      expect(mockQueue.add).toHaveBeenCalledWith('index-repo', data, {
        jobId: 'completed-job-id',
      });
    });
  });

  describe('removeJob', () => {
    it('removes a waiting job successfully', async () => {
      const mockJob = {
        getState: vi.fn().mockResolvedValue('waiting'),
        remove: vi.fn().mockResolvedValue(undefined),
      };

      mockQueue.getJob.mockResolvedValueOnce(mockJob);

      await service.removeJob('waiting-job-id');

      expect(mockQueue.getJob).toHaveBeenCalledWith('waiting-job-id');
      expect(mockJob.remove).toHaveBeenCalled();
    });

    it('returns silently when job does not exist', async () => {
      mockQueue.getJob.mockResolvedValueOnce(null);

      await service.removeJob('non-existent-id');

      expect(mockQueue.getJob).toHaveBeenCalledWith('non-existent-id');
      // No error thrown, just returns
    });

    it('skips removal for active jobs', async () => {
      const mockJob = {
        getState: vi.fn().mockResolvedValue('active'),
        remove: vi.fn(),
      };

      mockQueue.getJob.mockResolvedValueOnce(mockJob);

      await service.removeJob('active-job-id');

      expect(mockJob.remove).not.toHaveBeenCalled();
    });
  });

  describe('handleJobFailed', () => {
    it('calls onFailed for final failure when attemptsMade >= attempts', async () => {
      const callbacks: RepoIndexQueueCallbacks = {
        onProcess: vi.fn(),
        onStalled: vi.fn(),
        onRetry: vi.fn(),
        onFailed: vi.fn(),
      };
      service.setCallbacks(callbacks);

      // Extract the 'failed' event handler registered on the worker
      const failedHandler = mockWorker.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'failed',
      )?.[1] as (job: unknown, err: Error) => Promise<void>;

      expect(failedHandler).toBeDefined();

      const error = new Error('indexing failed permanently');
      const mockJob = {
        id: 'job-1',
        data: { repoIndexId: 'repo-index-1', repoUrl: 'url', branch: 'main' },
        attemptsMade: 3,
        opts: { attempts: 3 },
      };

      await failedHandler(mockJob, error);

      expect(callbacks.onFailed).toHaveBeenCalledWith('repo-index-1', error);
      expect(callbacks.onRetry).not.toHaveBeenCalled();
    });

    it('calls onRetry when more attempts remain', async () => {
      const callbacks: RepoIndexQueueCallbacks = {
        onProcess: vi.fn(),
        onStalled: vi.fn(),
        onRetry: vi.fn(),
        onFailed: vi.fn(),
      };
      service.setCallbacks(callbacks);

      const failedHandler = mockWorker.on.mock.calls.find(
        (call: unknown[]) => call[0] === 'failed',
      )?.[1] as (job: unknown, err: Error) => Promise<void>;

      expect(failedHandler).toBeDefined();

      const error = new Error('transient failure');
      const mockJob = {
        id: 'job-2',
        data: {
          repoIndexId: 'repo-index-2',
          repoUrl: 'url',
          branch: 'develop',
        },
        attemptsMade: 1,
        opts: { attempts: 3 },
      };

      await failedHandler(mockJob, error);

      expect(callbacks.onRetry).toHaveBeenCalledWith('repo-index-2', error);
      expect(callbacks.onFailed).not.toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('closes worker, queue, and redis', async () => {
      // Worker is created by setCallbacks, must call it first
      service.setCallbacks({
        onProcess: vi.fn(),
        onStalled: vi.fn(),
        onRetry: vi.fn(),
        onFailed: vi.fn(),
      });

      await service.onModuleDestroy();

      expect(mockWorker.close).toHaveBeenCalled();
      expect(mockQueue.close).toHaveBeenCalled();
      expect(mockRedis.quit).toHaveBeenCalled();
    });

    it('handles missing worker gracefully', async () => {
      // Worker not created (setCallbacks never called)
      await service.onModuleDestroy();

      expect(mockQueue.close).toHaveBeenCalled();
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});
