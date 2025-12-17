import { DefaultLogger } from '@packages/common';
import type { Redis as IORedis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import { CacheService } from './cache.service';

// We'll manually instantiate the service with a mocked Redis client
// instead of trying to mock the IORedis constructor

describe('CacheService', () => {
  let service: CacheService;
  let mockRedis: ReturnType<typeof mock<IORedis>>;
  let mockLogger: ReturnType<typeof mock<DefaultLogger>>;

  function createService() {
    mockRedis = mock<IORedis>();
    mockLogger = mock<DefaultLogger>();

    // Manually create service and inject mocked redis
    service = new CacheService(mockLogger);
    // Replace the redis instance with our mock
    (service as any).redis = mockRedis;
  }

  describe('get', () => {
    it('should get a string value by key', async () => {
      createService();
      const key = 'test:key';
      const value = 'test-value';

      mockRedis.get.mockResolvedValue(value);

      const result = await service.get(key);

      expect(result).toBe(value);
      expect(mockRedis.get).toHaveBeenCalledWith(key);
    });

    it('should return null if key does not exist', async () => {
      createService();
      mockRedis.get.mockResolvedValue(null);

      const result = await service.get('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should set a string value without TTL', async () => {
      createService();
      const key = 'test:key';
      const value = 'test-value';

      await service.set(key, value);

      expect(mockRedis.set).toHaveBeenCalledWith(key, value);
    });

    it('should set a string value with TTL', async () => {
      createService();
      const key = 'test:key';
      const value = 'test-value';
      const ttl = 3600;

      await service.set(key, value, ttl);

      expect(mockRedis.setex).toHaveBeenCalledWith(key, ttl, value);
    });
  });

  describe('del', () => {
    it('should delete a key', async () => {
      createService();
      const key = 'test:key';

      await service.del(key);

      expect(mockRedis.del).toHaveBeenCalledWith(key);
    });
  });

  describe('exists', () => {
    it('should return true if key exists', async () => {
      createService();
      mockRedis.exists.mockResolvedValue(1);

      const result = await service.exists('test:key');

      expect(result).toBe(true);
    });

    it('should return false if key does not exist', async () => {
      createService();
      mockRedis.exists.mockResolvedValue(0);

      const result = await service.exists('test:key');

      expect(result).toBe(false);
    });
  });

  describe('hset', () => {
    it('should set a hash field', async () => {
      createService();
      const key = 'test:hash';
      const field = 'field1';
      const value = 'value1';

      await service.hset(key, field, value);

      expect(mockRedis.hset).toHaveBeenCalledWith(key, field, value);
    });
  });

  describe('hget', () => {
    it('should get a hash field', async () => {
      createService();
      const key = 'test:hash';
      const field = 'field1';
      const value = 'value1';

      mockRedis.hget.mockResolvedValue(value);

      const result = await service.hget(key, field);

      expect(result).toBe(value);
      expect(mockRedis.hget).toHaveBeenCalledWith(key, field);
    });
  });

  describe('hgetall', () => {
    it('should get all hash fields', async () => {
      createService();
      const key = 'test:hash';
      const data = { field1: 'value1', field2: 'value2' };

      mockRedis.hgetall.mockResolvedValue(data);

      const result = await service.hgetall(key);

      expect(result).toEqual(data);
      expect(mockRedis.hgetall).toHaveBeenCalledWith(key);
    });
  });

  describe('hdel', () => {
    it('should delete a hash field', async () => {
      createService();
      const key = 'test:hash';
      const field = 'field1';

      await service.hdel(key, field);

      expect(mockRedis.hdel).toHaveBeenCalledWith(key, field);
    });
  });

  describe('hmset', () => {
    it('should set multiple hash fields', async () => {
      createService();
      const key = 'test:hash';
      const data = { field1: 'value1', field2: 'value2' };

      await service.hmset(key, data);

      expect(mockRedis.hmset).toHaveBeenCalledWith(key, data);
    });

    it('should not call hmset if data is empty', async () => {
      createService();
      const key = 'test:hash';
      const data = {};

      await service.hmset(key, data);

      expect(mockRedis.hmset).not.toHaveBeenCalled();
    });
  });

  describe('expire', () => {
    it('should set expiration on a key', async () => {
      createService();
      const key = 'test:key';
      const ttl = 3600;

      await service.expire(key, ttl);

      expect(mockRedis.expire).toHaveBeenCalledWith(key, ttl);
    });
  });

  describe('hmgetall', () => {
    it('should fetch multiple hash objects in batch', async () => {
      createService();
      const keys = ['test:hash1', 'test:hash2'];

      const mockPipeline = {
        hgetall: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, { field1: 'value1' }],
          [null, { field2: 'value2' }],
        ]),
      };
      mockRedis.pipeline.mockReturnValue(mockPipeline as any);

      const result = await service.hmgetall(keys);

      expect(mockPipeline.hgetall).toHaveBeenCalledTimes(2);
      expect(result.size).toBe(2);
      expect(result.get('test:hash1')).toEqual({ field1: 'value1' });
      expect(result.get('test:hash2')).toEqual({ field2: 'value2' });
    });

    it('should return empty map for empty input', async () => {
      createService();

      const result = await service.hmgetall([]);

      expect(result.size).toBe(0);
      expect(mockRedis.pipeline).not.toHaveBeenCalled();
    });

    it('should handle errors in pipeline results', async () => {
      createService();
      const keys = ['test:hash1', 'test:hash2'];

      const mockPipeline = {
        hgetall: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [new Error('Redis error'), null],
          [null, { field2: 'value2' }],
        ]),
      };
      mockRedis.pipeline.mockReturnValue(mockPipeline as any);

      const result = await service.hmgetall(keys);

      expect(result.size).toBe(1);
      expect(result.get('test:hash1')).toBeUndefined();
      expect(result.get('test:hash2')).toEqual({ field2: 'value2' });
    });
  });
});
