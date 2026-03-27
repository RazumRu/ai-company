import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { RuntimeInstanceEntity } from '../entity/runtime-instance.entity';

@Injectable()
export class RuntimeInstanceDao extends BaseDao<RuntimeInstanceEntity> {
  constructor(em: EntityManager) {
    super(em, RuntimeInstanceEntity);
  }
}
