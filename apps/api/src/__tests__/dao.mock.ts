import { vi } from 'vitest';

type MockRepositoryInstance = {
  createQueryBuilder: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orWhere: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
  andWhere: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  getCount: ReturnType<typeof vi.fn>;
  getMany: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  softDelete: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
  addGroupBy: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  addSelect: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  leftJoin: ReturnType<typeof vi.fn>;
  distinct: ReturnType<typeof vi.fn>;
  setParameter: ReturnType<typeof vi.fn>;
  setParameters: ReturnType<typeof vi.fn>;
  orUpdate: ReturnType<typeof vi.fn>;
  withDeleted: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  getOne: ReturnType<typeof vi.fn>;
  getRawMany: ReturnType<typeof vi.fn>;
  getRawOne: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
};

export const getRepositoryMock = (): MockRepositoryInstance => {
  const instance: MockRepositoryInstance = {
    createQueryBuilder: vi.fn(() => instance),
    insert: vi.fn(() => instance),
    values: vi.fn(() => instance),
    returning: vi.fn(() => instance),
    execute: vi.fn(() => instance),
    where: vi.fn(() => instance),
    orWhere: vi.fn(() => instance),
    update: vi.fn(() => instance),
    limit: vi.fn(() => instance),
    offset: vi.fn(() => instance),
    andWhere: vi.fn(() => instance),
    set: vi.fn(() => instance),
    from: vi.fn(() => instance),
    getCount: vi.fn(() => instance),
    getMany: vi.fn(() => instance),
    orderBy: vi.fn(() => instance),
    delete: vi.fn(() => instance),
    softDelete: vi.fn(() => instance),
    groupBy: vi.fn(() => instance),
    addGroupBy: vi.fn(() => instance),
    select: vi.fn(() => instance),
    addSelect: vi.fn(() => instance),
    innerJoin: vi.fn(() => instance),
    leftJoin: vi.fn(() => instance),
    distinct: vi.fn(() => instance),
    setParameter: vi.fn(() => instance),
    setParameters: vi.fn(() => instance),
    orUpdate: vi.fn(() => instance),
    withDeleted: vi.fn(() => instance),
    restore: vi.fn(() => instance),
    findOne: vi.fn(),
    getOne: vi.fn(),
    getRawMany: vi.fn(),
    getRawOne: vi.fn(),
    find: vi.fn(),
  };

  return instance;
};
