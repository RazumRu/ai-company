import { DynamicModule, Global } from '@nestjs/common';

import { RequestContextService } from './request-context.service';
import { RequestContextLogger } from './request-context-logger';

@Global()
export class AppContextModule {
  static forRoot(): DynamicModule {
    const providers: any = [RequestContextService, RequestContextLogger];

    return {
      module: AppContextModule,
      exports: providers,
      providers,
    };
  }
}
