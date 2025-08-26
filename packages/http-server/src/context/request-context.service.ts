import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import rTracer from 'cls-rtracer';
import { FastifyRequest } from 'fastify';

import { IRequestData } from '../http-server.types';

@Injectable({
  scope: Scope.REQUEST,
})
export class RequestContextService {
  constructor(
    @Inject(REQUEST)
    public readonly request: FastifyRequest & FastifyRequest['raw'],
  ) {}

  public getRequestData(): IRequestData {
    const requestId = (rTracer?.id() as string) || '';

    return {
      requestId,
      ip: this.request.ip,
      method: this.request.method,
      body: this.request.body,
      url: this.request.originalUrl,
      ...((<any>this.request).__contextData || {}),
    };
  }
}
