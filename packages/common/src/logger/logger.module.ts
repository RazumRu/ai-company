import { DynamicModule, Global, Provider, Type } from '@nestjs/common';
import { compact } from 'lodash';

import { BaseLogger } from './base-logger';
import { DefaultLogger } from './default-logger';
import { ILoggerParams, Logger, LoggerParams } from './logger.types';
import { SentryService } from './sentry.service';

@Global()
export class LoggerModule {
  static forRoot(
    param: ILoggerParams,
    instance?: Type<BaseLogger>,
  ): DynamicModule {
    const providers: Provider[] = compact([
      {
        provide: LoggerParams,
        useValue: param,
      },
      DefaultLogger,
      instance,
      {
        provide: Logger,
        useClass: instance ?? DefaultLogger,
      },
      SentryService,
    ]);

    return {
      module: LoggerModule,
      exports: providers,
      providers,
    };
  }
}
