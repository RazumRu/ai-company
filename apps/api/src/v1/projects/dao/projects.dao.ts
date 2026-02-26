import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource, In } from 'typeorm';

import { ProjectEntity } from '../entity/project.entity';

export type ProjectSearchTerms = Partial<{
  id: string;
  ids: string[];
  createdBy: string;
}>;

@Injectable()
export class ProjectsDao extends BaseDao<ProjectEntity, ProjectSearchTerms> {
  public get alias() {
    return 'p';
  }

  protected get entity() {
    return ProjectEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<ProjectEntity>,
    params?: ProjectSearchTerms,
  ) {
    if (params?.ids && params.ids.length > 0) {
      builder.andWhere({ id: In(params.ids) });
    }

    if (params?.id) {
      builder.andWhere({ id: params.id });
    }

    if (params?.createdBy) {
      builder.andWhere({ createdBy: params.createdBy });
    }
  }
}
