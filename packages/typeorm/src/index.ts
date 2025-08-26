import { TypeOrmModule } from '@nestjs/typeorm';
import { IAppBootstrapperExtension } from '@packages/common';
import { DataSource, EntitySchema } from 'typeorm';

import { TypeormModule } from './typeorm.module';

export * from './utils';
export * from './entity/timestamps.entity';
export * from './typeorm.service';
export * from 'typeorm';
export * from './base.dao';

export { TypeormModule, DataSource };

export const registerEntities = (entities?: (any | EntitySchema)[]) =>
  TypeOrmModule.forFeature(entities);

export const buildTypeormExtension = (
  dataSource: DataSource,
): IAppBootstrapperExtension => {
  return {
    modules: [TypeormModule.forRoot(dataSource)],
  };
};
