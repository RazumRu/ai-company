import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { IsolationLevel } from 'typeorm/driver/types/IsolationLevel';

@Injectable()
export class TypeormService {
  constructor(private readonly connection: DataSource) {}

  public trx<T = unknown>(
    cb: (entityManager: EntityManager) => Promise<T>,
    entityManager?: EntityManager,
  ): Promise<T> {
    return entityManager ? cb(entityManager) : this.connection.transaction(cb);
  }

  public trxWithIsolationLevel<T = unknown>(
    isolationLevel: IsolationLevel,
    cb: (entityManager: EntityManager) => Promise<T>,
    entityManager?: EntityManager,
  ): Promise<T> {
    return entityManager
      ? cb(entityManager)
      : this.connection.transaction(isolationLevel, cb);
  }
}
