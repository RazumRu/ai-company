import { DynamicModule, Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

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
}
