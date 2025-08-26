import { vi } from 'vitest';

export const getRepositoryMock = (): any => {
  const instance: any = {
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
