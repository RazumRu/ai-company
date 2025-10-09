import compress, { FastifyCompressOptions } from '@fastify/compress';
import multipart from '@fastify/multipart';
import {
  ClassSerializerInterceptor,
  DynamicModule,
  INestApplication,
  RequestMethod,
  VersioningType,
} from '@nestjs/common';
import { ContextIdFactory, NestFactory, Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  DocumentBuilder,
  OpenAPIObject,
  SwaggerCustomOptions,
  SwaggerModule,
} from '@nestjs/swagger';
import {
  AppBootstrapperConfigService,
  DefaultLogger,
  IAppBootstrapperExtension,
  Logger,
} from '@packages/common';
import { apiReference } from '@scalar/nestjs-api-reference';
import rTracer from 'cls-rtracer';
import { FastifyInstance } from 'fastify';
import qs from 'fastify-qs';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';

import { RequestContextLogger } from './context';
import { ExceptionsFilter } from './exceptions.filter';
import { HttpServerModule } from './http-server.module';
import { IHttpServerParams } from './http-server.types';
import { ZodResponseInterceptor } from './interceptors/zod-response.interceptor';

export const getVersion = (v?: string) =>
  `${v ? `v${v}` : ``}`
    .replace(/\/$/, '')
    .replace(/^\//, '')
    .replace(/\/{1,}/g, '/');

export const setupSwagger = (
  app: INestApplication,
  {
    path = '/swagger-api',
    appName,
    version,
    description,
    securitySchemas,
    options,
  }: {
    path?: string;
    appName: string;
    version: string;
    description?: string;
    securitySchemas?: Record<string, any>;
    options?: SwaggerCustomOptions;
  },
) => {
  const builder = new DocumentBuilder().setTitle(appName).setVersion(version);

  if (!securitySchemas) {
    builder.addBearerAuth();
  } else {
    Object.entries(securitySchemas).forEach(([name, schema]) => {
      builder.addSecurity(name, schema);
    });
  }

  if (description) {
    builder.setDescription(description);
  }

  const openapiDocumentBase = builder.build();

  const openapiDocument = SwaggerModule.createDocument(
    app,
    openapiDocumentBase,
    {
      operationIdFactory: (controllerKey: string, methodKey: string) =>
        methodKey,
    },
  );
  const swp = [path].join('/').replace(/\/{1,}/g, '/');

  SwaggerModule.setup(swp, app, cleanupOpenApiDoc(openapiDocument), options);

  app.use(
    `${swp}/reference`,
    apiReference({
      content: openapiDocument,
      layout: 'modern',
      withFastify: true,
      showSidebar: true,
      darkMode: true,
    }),
  );
};

export const setupMiddlewares = (
  app: INestApplication,
  {
    helmetOptions,
    compression,
    stripResponse = true,
  }: {
    helmetOptions?: Parameters<typeof helmet>[0];
    compression?: FastifyCompressOptions;
    stripResponse?: boolean;
  },
) => {
  const serverApp = <NestFastifyApplication>app;
  const fastifyInstance: FastifyInstance = <FastifyInstance>(
    (<unknown>serverApp.getHttpAdapter().getInstance())
  );

  // if (sentryService.isSentryInit && param.logger?.sentry?.enabledHttpTracing) {
  //   app.use(Sentry.Handlers.requestHandler());
  // }

  fastifyInstance.register(<any>qs, { comma: true });

  serverApp.useGlobalFilters(new ExceptionsFilter(serverApp));

  //serverApp.useGlobalPipes(new ValidationPipe());
  serverApp.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
  );

  if (stripResponse) {
    serverApp.useGlobalInterceptors(
      new ZodResponseInterceptor(app.get(Reflector)),
    );
  }

  serverApp.enableCors({
    methods: '*',
    origin: '*',
  });
  serverApp.use(helmet(helmetOptions || { contentSecurityPolicy: false }));

  if (compression) {
    fastifyInstance.register(compress, compression);
  }

  fastifyInstance.register(multipart);
  app.use(
    rTracer.fastifyMiddleware({
      useHeader: true,
      echoHeader: true,
      headerName: 'X-Request-Id',
    }),
  );

  fastifyInstance.addHook('preHandler', async (req) => {
    const contextId = ContextIdFactory.create();
    app.registerRequestByContextId(req, contextId);
    const logger = await app.resolve(Logger, contextId);
    const { method, originalUrl } = req;

    logger.log(`Request ${method}: ${originalUrl}`);
  });
};

export const setupPrefix = (
  app: INestApplication,
  {
    apiDefaultVersion,
    globalPrefix,
    globalPrefixIgnore,
  }: Pick<
    IHttpServerParams,
    'apiDefaultVersion' | 'globalPrefix' | 'globalPrefixIgnore'
  >,
) => {
  const resultVersion = getVersion(apiDefaultVersion);

  if (resultVersion) {
    app.enableVersioning({
      defaultVersion: resultVersion,
      prefix: false,
      type: VersioningType.URI,
    });
  }

  if (globalPrefix) {
    app.setGlobalPrefix(globalPrefix, {
      exclude: [
        {
          path: '/health/check',
          method: RequestMethod.ALL,
        },
        {
          path: '/metrics/',
          method: RequestMethod.ALL,
        },
        ...(globalPrefixIgnore || []).map((c) => ({
          path: c,
          method: RequestMethod.ALL,
        })),
      ],
    });
  }
};

export const buildHttpNestApp = async (
  appBootstrapperModule: DynamicModule,
  params: IHttpServerParams,
) => {
  const adapter = new FastifyAdapter(params.fastifyOptions);
  const app = await NestFactory.create(appBootstrapperModule, <any>adapter, {
    rawBody: true,
  });
  const cfg = app.get(AppBootstrapperConfigService);

  setupMiddlewares(app, {
    helmetOptions: params.helmetOptions,
    compression: params.compression,
    stripResponse: params.stripResponse,
  });

  setupPrefix(app, {
    apiDefaultVersion: params.apiDefaultVersion,
    globalPrefix: params.globalPrefix,
    globalPrefixIgnore: params.globalPrefixIgnore,
  });

  if (params.swagger) {
    setupSwagger(app, {
      ...params.swagger,
      appName: cfg.appName,
      version: cfg.appVersion,
    });
  }

  return app;
};

export const runHttpApp = async (
  app: INestApplication,
  params: IHttpServerParams,
) => {
  const port = params.port || 3000;
  await (<INestApplication>app).listen(port, '0.0.0.0');

  const logger = app.get(DefaultLogger);

  logger.log(`HTTP server init with port ${params.port}`);
};

export const buildHttpServerExtension = (
  params: IHttpServerParams,
): IAppBootstrapperExtension => {
  return {
    modules: [HttpServerModule.forRoot(params)],
    defaultLogger: RequestContextLogger,
    customBootstrapper: async (module) => {
      const app = await buildHttpNestApp(module, params);

      await runHttpApp(app, params);
    },
  };
};
