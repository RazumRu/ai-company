import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { GitProviderConnectionEntity } from '../entity/git-provider-connection.entity';

@Injectable()
export class GitProviderConnectionDao extends BaseDao<GitProviderConnectionEntity> {
  constructor(em: EntityManager) {
    super(em, GitProviderConnectionEntity);
  }
}
