import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import { BaseLogger, Logger } from '@packages/common';
import { FastifyReply, FastifyRequest } from 'fastify';

import { AuthContextService } from '../auth-context.service';

@Injectable()
export class FetchContextDataMiddleware implements NestMiddleware {
  constructor(
    private readonly contextService: AuthContextService,
    @Inject(Logger)
    private readonly logger: BaseLogger,
  ) {}

  use(
    req: FastifyRequest & Record<string, unknown>,
    res: FastifyReply,
    next: () => void,
  ) {
    this.contextService
      .init()
      .then((contextData) => {
        req.__contextData = contextData;

        return next();
      })
      .catch((e) => {
        this.logger.error(<Error>e, 'Cannot verify the token');
        return next();
      });
  }
}
