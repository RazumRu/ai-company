import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { ProjectEntity } from '../entity/project.entity';

@Injectable()
export class ProjectsDao extends BaseDao<ProjectEntity> {
  constructor(em: EntityManager) {
    super(em, ProjectEntity);
  }
}
