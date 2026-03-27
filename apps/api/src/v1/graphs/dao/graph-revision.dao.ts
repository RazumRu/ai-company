import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { GraphRevisionEntity } from '../entity/graph-revision.entity';

@Injectable()
export class GraphRevisionDao extends BaseDao<GraphRevisionEntity> {
  constructor(em: EntityManager) {
    super(em, GraphRevisionEntity);
  }
}
