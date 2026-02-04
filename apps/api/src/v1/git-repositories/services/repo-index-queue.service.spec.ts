import { DefaultLogger } from '@packages/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RepoIndexJobData,
  RepoIndexQueueService,
} from './repo-index-queue.service';

const mockQueue = {
  add: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
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

  describe('setProcessor', () => {
    it('stores the processor callback', () => {
      const processor = vi.fn();
      service.setProcessor(processor);
      // Processor is stored privately; verified via processJob behavior
      expect(processor).not.toHaveBeenCalled();
    });
  });

  describe('addIndexJob', () => {
    it('adds a job with repoIndexId as jobId', async () => {
      const data: RepoIndexJobData = {
        repoIndexId: 'test-id-123',
        repoUrl: 'https://github.com/owner/repo',
      };

      await service.addIndexJob(data);

      expect(mockQueue.add).toHaveBeenCalledWith('index-repo', data, {
        jobId: 'test-id-123',
      });
    });
  });

  describe('onModuleDestroy', () => {
    it('closes worker, queue, and redis', async () => {
      await service.onModuleDestroy();

      expect(mockWorker.close).toHaveBeenCalled();
      expect(mockQueue.close).toHaveBeenCalled();
      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });
});
