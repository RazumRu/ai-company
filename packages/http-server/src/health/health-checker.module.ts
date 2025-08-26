import { DynamicModule, Module, Type } from '@nestjs/common';

import { HealthCheckerController } from './health-checker.controller';

@Module({})
export class HealthCheckerModule {
  static forRoot(): DynamicModule {
    const providers: Type<any>[] = [];

    return {
      controllers: [HealthCheckerController],
      module: HealthCheckerModule,
      exports: providers,
      providers,
    };
  }
}
