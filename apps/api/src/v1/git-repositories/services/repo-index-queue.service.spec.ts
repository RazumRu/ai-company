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
