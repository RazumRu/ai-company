import {
  ArgumentsHost,
  Catch,
  HttpServer,
  type INestApplication,
} from '@nestjs/common';
import {
  BaseExceptionFilter,
  ContextIdFactory,
  HttpAdapterHost,
} from '@nestjs/core';
import { BaseLogger, Logger, SentryService } from '@packages/common';
import { FastifyRequest } from 'fastify';

import { RequestContextService } from './context';
import { ExceptionHandler } from './exception-handler';

@Catch()
export class ExceptionsFilter extends BaseExceptionFilter {
  constructor(private readonly moduleRef: INestApplication) {
    const applicationRef = <HttpServer>moduleRef.get(HttpAdapterHost);

    super(applicationRef);
  }

  async catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const contextId = ContextIdFactory.create();
    const response = ctx.getResponse() as {
      status: (code: number) => { send: (data: unknown) => void };
    };
    const request = ctx.getRequest<FastifyRequest & FastifyRequest['raw']>();

    this.moduleRef.registerRequestByContextId(request, contextId);

    const sentryService = await this.moduleRef.resolve<SentryService>(
      SentryService,
      contextId,
    );
    const logger = await this.moduleRef.resolve<BaseLogger>(Logger, contextId);

    const exceptionHandler = new ExceptionHandler(
      new RequestContextService(request),
      logger,
      sentryService,
    );

    const data = exceptionHandler.handle(exception);

    response.status(data.statusCode).send({
      statusCode: data.statusCode,
      code: data.code,
      message: data.message,
      fullMessage: data.fullMessage,
      fields: data.fields,
    });
  }
}
