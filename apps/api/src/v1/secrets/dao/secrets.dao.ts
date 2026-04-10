import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { SecretEntity } from '../entity/secret.entity';

@Injectable()
export class SecretsDao extends BaseDao<SecretEntity> {
  constructor(em: EntityManager) {
    super(em, SecretEntity);
  }
}
