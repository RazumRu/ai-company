import { DynamicModule, Global, MiddlewareConsumer } from '@nestjs/common';
import { compact } from 'lodash';

import { HttpServerAuthParams } from '../http-server.types';
import { IAuthModuleParams } from './auth.types';
import { AuthContextService } from './auth-context.service';
import { FetchContextDataMiddleware } from './middleware/fetch-context-data.middleware';
import { AuthProvider } from './providers/auth.provider';

@Global()
export class AuthModule {
  static forRoot(params?: IAuthModuleParams): DynamicModule {
    const providers = compact([
      {
        provide: HttpServerAuthParams,
        useValue: params,
      },
      params?.provider && {
        provide: AuthProvider,
        useValue: params?.provider,
      },
      AuthContextService,
    ]);

    return {
      module: AuthModule,
      providers,
      exports: providers,
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(FetchContextDataMiddleware).forRoutes('*');
  }
}
