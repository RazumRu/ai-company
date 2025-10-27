import type { RunnableConfig } from '@langchain/core/runnables';
import type {
  Checkpoint,
  CheckpointMetadata,
  PendingWrite,
} from '@langchain/langgraph-checkpoint';
import { Test, TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphCheckpointsDao } from '../dao/graph-checkpoints.dao';
import { GraphCheckpointsWritesDao } from '../dao/graph-checkpoints-writes.dao';
import { PgCheckpointSaver } from './pg-checkpoint-saver';

describe('PgCheckpointSaver', () => {
  let service: PgCheckpointSaver;
  let mockGraphCheckpointsDao: any;
  let mockGraphCheckpointsWritesDao: any;

  beforeEach(async () => {
    mockGraphCheckpointsDao = {
      getOne: vi.fn(),
      create: vi.fn(),
      updateById: vi.fn(),
      getAll: vi.fn(),
      hardDelete: vi.fn(),
    };

    mockGraphCheckpointsWritesDao = {
      getAll: vi.fn(),
      getOne: vi.fn(),
      create: vi.fn(),
      updateById: vi.fn(),
      hardDelete: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PgCheckpointSaver,
        {
          provide: GraphCheckpointsDao,
          useValue: mockGraphCheckpointsDao,
        },
        {
          provide: GraphCheckpointsWritesDao,
          useValue: mockGraphCheckpointsWritesDao,
        },
      ],
    }).compile();

    service = await module.resolve<PgCheckpointSaver>(PgCheckpointSaver);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('put', () => {
    it('should save checkpoint to database', async () => {
      const config: RunnableConfig = {
        configurable: {
          thread_id: 'test-thread-123',
          checkpoint_ns: 'test-ns',
        },
      };

      const checkpoint: Checkpoint = {
        id: 'checkpoint-123',
        ts: '2024-01-01T00:00:00Z',
        channel_values: {},
        channel_versions: {},
        versions_seen: {},
        v: 1,
      };

      const metadata: CheckpointMetadata = {
        source: 'input',
        step: 1,
        parents: {},
      };

      mockGraphCheckpointsDao.getOne.mockResolvedValue(null);
      mockGraphCheckpointsDao.create.mockResolvedValue({ id: 'db-id' });

      await service.put(config, checkpoint, metadata);

      expect(mockGraphCheckpointsDao.create).toHaveBeenCalled();
    });
  });

  describe('putWrites', () => {
    it('should save writes to database', async () => {
      const config: RunnableConfig = {
        configurable: {
          thread_id: 'test-thread-123',
          checkpoint_ns: 'test-ns',
          checkpoint_id: 'checkpoint-123',
        },
      };

      const writes: PendingWrite[] = [
        ['messages', { content: 'Hello world', type: 'human' }],
        ['tools', { name: 'search', args: { query: 'test' } }],
      ];

      const taskId = 'task-123';

      mockGraphCheckpointsWritesDao.getOne.mockResolvedValue(null);
      mockGraphCheckpointsWritesDao.create.mockResolvedValue({ id: 'db-id' });

      await service.putWrites(config, writes, taskId);

      expect(mockGraphCheckpointsWritesDao.create).toHaveBeenCalledTimes(2);
    });

    it('should update existing writes', async () => {
      const config: RunnableConfig = {
        configurable: {
          thread_id: 'test-thread-123',
          checkpoint_ns: 'test-ns',
          checkpoint_id: 'checkpoint-123',
        },
      };

      const writes: PendingWrite[] = [
        ['messages', { content: 'Hello world', type: 'human' }],
      ];

      const taskId = 'task-123';

      mockGraphCheckpointsWritesDao.getOne.mockResolvedValue({
        id: 'existing-id',
      });
      mockGraphCheckpointsWritesDao.updateById.mockResolvedValue({
        id: 'existing-id',
      });

      await service.putWrites(config, writes, taskId);

      expect(mockGraphCheckpointsWritesDao.updateById).toHaveBeenCalledTimes(1);
    });
  });
});
