import type { EntityManager, SqlEntityRepository } from '@mikro-orm/postgresql';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BaseDao } from './base.dao';

class TestEntity {
  id!: string;
  name!: string;
  deletedAt: Date | null = null;
}

class TestDao extends BaseDao<TestEntity> {
  constructor(em: EntityManager) {
    super(em, TestEntity);
  }
}

function createMockRepo(): SqlEntityRepository<TestEntity> {
  return {
    find: vi.fn(),
    findOne: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    nativeUpdate: vi.fn(),
    nativeDelete: vi.fn(),
  } as unknown as SqlEntityRepository<TestEntity>;
}

function createMockEm(repo: SqlEntityRepository<TestEntity>): EntityManager {
  return {
    flush: vi.fn(),
    getRepository: vi.fn().mockReturnValue(repo),
  } as unknown as EntityManager;
}

describe('BaseDao', () => {
  let em: EntityManager;
  let repo: SqlEntityRepository<TestEntity>;
  let dao: TestDao;

  beforeEach(() => {
    repo = createMockRepo();
    em = createMockEm(repo);
    dao = new TestDao(em);
  });

  it('getAll delegates to repo.find with correct args', async () => {
    const where = { name: 'test' };
    const options = { limit: 10 };
    const expected = [{ id: '1', name: 'test', deletedAt: null }];
    vi.mocked(repo.find).mockResolvedValue(expected);

    const result = await dao.getAll(where as never, options as never);

    expect(repo.find).toHaveBeenCalledWith(where, options);
    expect(result).toBe(expected);
  });

  it('getOne delegates to repo.findOne', async () => {
    const where = { name: 'test' };
    const expected = { id: '1', name: 'test', deletedAt: null };
    vi.mocked(repo.findOne).mockResolvedValue(expected);

    const result = await dao.getOne(where as never);

    expect(repo.findOne).toHaveBeenCalledWith(where, undefined);
    expect(result).toBe(expected);
  });

  it('getById calls repo.findOne with { id } filter', async () => {
    const expected = { id: 'abc', name: 'test', deletedAt: null };
    vi.mocked(repo.findOne).mockResolvedValue(expected);

    const result = await dao.getById('abc');

    expect(repo.findOne).toHaveBeenCalledWith({ id: 'abc' });
    expect(result).toBe(expected);
  });

  it('count delegates to repo.count', async () => {
    const where = { name: 'test' };
    vi.mocked(repo.count).mockResolvedValue(42);

    const result = await dao.count(where as never);

    expect(repo.count).toHaveBeenCalledWith(where);
    expect(result).toBe(42);
  });

  it('create calls repo.create with partial option + em.flush', async () => {
    const data = { name: 'new' };
    const created = { id: '1', name: 'new', deletedAt: null };
    vi.mocked(repo.create).mockReturnValue(created as never);

    const result = await dao.create(data);

    expect(repo.create).toHaveBeenCalledWith(data, { partial: true });
    expect(em.flush).toHaveBeenCalledOnce();
    expect(result).toBe(created);
  });

  it('create with txEm uses transactional EM repo', async () => {
    const txRepo = createMockRepo();
    const txEm = createMockEm(txRepo);
    const data = { name: 'new' };
    const created = { id: '1', name: 'new', deletedAt: null };
    vi.mocked(txRepo.create).mockReturnValue(created as never);

    const result = await dao.create(data, txEm);

    expect(txEm.getRepository).toHaveBeenCalledWith(TestEntity);
    expect(txRepo.create).toHaveBeenCalledWith(data, { partial: true });
    expect(txEm.flush).toHaveBeenCalledOnce();
    expect(em.flush).not.toHaveBeenCalled();
    expect(result).toBe(created);
  });

  it('createMany creates multiple entities and flushes once', async () => {
    const data = [{ name: 'a' }, { name: 'b' }];
    const entityA = { id: '1', name: 'a', deletedAt: null };
    const entityB = { id: '2', name: 'b', deletedAt: null };
    vi.mocked(repo.create)
      .mockReturnValueOnce(entityA as never)
      .mockReturnValueOnce(entityB as never);

    const result = await dao.createMany(data);

    expect(repo.create).toHaveBeenCalledTimes(2);
    expect(repo.create).toHaveBeenCalledWith(data[0], { partial: true });
    expect(repo.create).toHaveBeenCalledWith(data[1], { partial: true });
    expect(em.flush).toHaveBeenCalledOnce();
    expect(result).toEqual([entityA, entityB]);
  });

  it('updateById calls repo.nativeUpdate with id filter', async () => {
    vi.mocked(repo.nativeUpdate).mockResolvedValue(1);

    const result = await dao.updateById('abc', { name: 'updated' });

    expect(repo.nativeUpdate).toHaveBeenCalledWith(
      { id: 'abc' },
      { name: 'updated' },
    );
    expect(result).toBe(1);
  });

  it('updateById with txEm uses transactional EM repo', async () => {
    const txRepo = createMockRepo();
    const txEm = createMockEm(txRepo);
    vi.mocked(txRepo.nativeUpdate).mockResolvedValue(1);

    const result = await dao.updateById('abc', { name: 'updated' }, txEm);

    expect(txRepo.nativeUpdate).toHaveBeenCalledWith(
      { id: 'abc' },
      { name: 'updated' },
    );
    expect(repo.nativeUpdate).not.toHaveBeenCalled();
    expect(result).toBe(1);
  });

  it('deleteById sets deletedAt via repo.nativeUpdate', async () => {
    const beforeCall = new Date();
    await dao.deleteById('abc');

    expect(repo.nativeUpdate).toHaveBeenCalledOnce();
    const [filter, update] = vi.mocked(repo.nativeUpdate).mock.calls[0]!;
    expect(filter).toEqual({ id: 'abc' });
    expect(
      (update as { deletedAt: Date }).deletedAt.getTime(),
    ).toBeGreaterThanOrEqual(beforeCall.getTime());
  });

  it('deleteById with txEm uses transactional EM repo', async () => {
    const txRepo = createMockRepo();
    const txEm = createMockEm(txRepo);

    await dao.deleteById('abc', txEm);

    expect(txEm.getRepository).toHaveBeenCalledWith(TestEntity);
    expect(txRepo.nativeUpdate).toHaveBeenCalledWith(
      { id: 'abc' },
      expect.objectContaining({ deletedAt: expect.any(Date) }),
    );
    expect(repo.nativeUpdate).not.toHaveBeenCalled();
  });

  it('hardDeleteById calls repo.nativeDelete', async () => {
    await dao.hardDeleteById('abc');

    expect(repo.nativeDelete).toHaveBeenCalledWith({ id: 'abc' });
  });

  it('hardDeleteById with txEm uses transactional EM repo', async () => {
    const txRepo = createMockRepo();
    const txEm = createMockEm(txRepo);

    await dao.hardDeleteById('abc', txEm);

    expect(txEm.getRepository).toHaveBeenCalledWith(TestEntity);
    expect(txRepo.nativeDelete).toHaveBeenCalledWith({ id: 'abc' });
    expect(repo.nativeDelete).not.toHaveBeenCalled();
  });

  it('hardDelete calls repo.nativeDelete with filter', async () => {
    const where = { name: 'test' };
    await dao.hardDelete(where as never);

    expect(repo.nativeDelete).toHaveBeenCalledWith(where);
  });

  it('hardDelete with txEm uses transactional EM repo', async () => {
    const txRepo = createMockRepo();
    const txEm = createMockEm(txRepo);
    const where = { name: 'test' };

    await dao.hardDelete(where as never, txEm);

    expect(txEm.getRepository).toHaveBeenCalledWith(TestEntity);
    expect(txRepo.nativeDelete).toHaveBeenCalledWith(where);
    expect(repo.nativeDelete).not.toHaveBeenCalled();
  });
});
