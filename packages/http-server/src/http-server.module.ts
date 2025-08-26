import { DynamicModule, Module } from '@nestjs/common';

import { AuthModule } from './auth';
import { AppContextModule } from './context';
import { ExceptionHandler } from './exception-handler';
import { HealthCheckerModule } from './health/health-checker.module';
import { HttpServerParams, IHttpServerParams } from './http-server.types';

@Module({})
export class HttpServerModule {
  static forRoot(params: IHttpServerParams): DynamicModule {
    const providers = [
      {
        provide: HttpServerParams,
        useValue: params,
      },
      ExceptionHandler,
    ];

    return {
      imports: [AppContextModule.forRoot(), HealthCheckerModule.forRoot()],
      module: HttpServerModule,
      exports: providers,
      providers,
    };
  }
}
