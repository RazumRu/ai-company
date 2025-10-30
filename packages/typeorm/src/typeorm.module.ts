import { DynamicModule, Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MixedList } from 'typeorm/common/MixedList';
import { EntitySchema } from 'typeorm/entity-schema/EntitySchema';

import { TypeormService } from './typeorm.service';

@Module({})
@Global()
export class TypeormModule {
  static forRoot(dataSource: DataSource): DynamicModule {
    const providers = [
      TypeormService,
      {
        provide: DataSource,
        useValue: dataSource,
      },
    ];

    return {
      module: TypeormModule,
      imports: [
        TypeOrmModule.forRootAsync({
          useFactory: async () => {
            return dataSource.options;
          },
          dataSourceFactory: async () => {
            return dataSource;
          },
          imports: [],
        }),
      ],
      providers,
      exports: providers,
    };
  }

  static forRootTesting(
    dataSource: DataSource,
    entities: MixedList<
      (new (...args: unknown[]) => unknown) | string | EntitySchema
    >,
  ): DynamicModule {
    dataSource.setOptions({
      ...dataSource.options,
      entities,
      migrations: undefined,
      migrationsRun: false,
    });

    return this.forRoot(dataSource);
  }
}
