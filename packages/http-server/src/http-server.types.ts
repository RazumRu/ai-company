import { FastifyCompressOptions } from '@fastify/compress';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { SwaggerCustomOptions } from '@nestjs/swagger';
import { IExceptionData, ISentryLogData } from '@packages/common';
import helmet from 'helmet';

export interface IHttpServerParams {
  globalPrefix?: string;
  globalPrefixIgnore?: string[];
  swagger?: {
    options?: SwaggerCustomOptions;
    path?: string;
    description?: string;
    securitySchemas?: Record<string, unknown>;
  };
  apiDefaultVersion?: string;
  port?: number;
  fastifyOptions?: ConstructorParameters<typeof FastifyAdapter>[0];
  helmetOptions?: Parameters<typeof helmet>[0];
  // compression with @fastify/compress
  compression?: FastifyCompressOptions;
  stripResponse?: boolean;
}

export interface IRequestData {
  userId?: string;
  requestId: string;
  ip: string;
  method: string;
  body: unknown;
  url: string;
  [key: string]: unknown;
}

export interface ISentryExceptionData
  extends Partial<IRequestData>,
    IExceptionData {
  level: ISentryLogData['level'];
}

export enum HealthStatus {
  Ok = 'Ok',
  Failed = 'Failed',
}

export const HttpServerParams = Symbol('HttpServerParams');
export const HttpServerAuthParams = Symbol('HttpServerAuthParams');
