import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule, TestingModuleBuilder } from '@nestjs/testing';
import { buildBootstrapper, LogLevel } from '@packages/common';
import {
  AuthContextService,
  buildAuthExtension,
  buildHttpServerExtension,
  KeycloakProvider,
} from '@packages/http-server';
import { buildMetricExtension } from '@packages/metrics';
import { buildTypeormExtension } from '@packages/typeorm';
import { DataSource } from 'typeorm';

import { AppModule } from '../../app.module';
import typeormconfig from '../../db/typeormconfig';
import { environment } from '../../environments';
import { GraphCheckpointEntity } from '../../v1/agents/entity/graph-chekpoints.entity';
import { GraphCheckpointWritesEntity } from '../../v1/agents/entity/graph-chekpoints-writes.entity';
import { GraphEntity } from '../../v1/graphs/entity/graph.entity';
import { GraphRevisionEntity } from '../../v1/graphs/entity/graph-revision.entity';
import { RuntimeInstanceEntity } from '../../v1/runtime/entity/runtime-instance.entity';
import { MessageEntity } from '../../v1/threads/entity/message.entity';
import { ThreadEntity } from '../../v1/threads/entity/thread.entity';

export const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';

export const createTestModule = async (
  cb?: (testingModule: TestingModuleBuilder) => Promise<TestingModule>,
) => {
  const testBootstrapper = buildBootstrapper({
    environment: environment.env,
    appName: environment.appName,
    appVersion: environment.tag,
  });

  testBootstrapper.addExtension(
    buildHttpServerExtension({
      globalPrefix: environment.globalPrefix,
      apiDefaultVersion: '1',
      port: environment.port,
      swagger: {
        path: environment.swaggerPath,
      },
      helmetOptions: {
        contentSecurityPolicy: false,
        crossOriginOpenerPolicy: {
          policy: 'unsafe-none',
        },
      },
      fastifyOptions: {
        trustProxy: 'loopback',
      },
    }),
  );

  testBootstrapper.addExtension(
    buildAuthExtension({
      devMode: environment.authDevMode,
      provider: new KeycloakProvider({
        url: environment.keycloakUrl,
        realms: [environment.keycloakRealm],
      }),
    }),
  );

  testBootstrapper.addExtension(buildMetricExtension());

  testBootstrapper.addExtension(
    buildTypeormExtension(
      new DataSource({
        ...typeormconfig.options,
        entities: [
          GraphEntity,
          ThreadEntity,
          GraphCheckpointEntity,
          GraphCheckpointWritesEntity,
          MessageEntity,
          GraphRevisionEntity,
          RuntimeInstanceEntity,
        ],
      }),
    ),
  );

  testBootstrapper.setupLogger({
    prettyPrint: environment.prettyLog,
    level: <LogLevel>environment.logLevel,
    sentryDsn: environment.sentryDsn,
  });

  const m = await Test.createTestingModule({
    imports: [testBootstrapper.buildModule([AppModule])],
  })
    .overrideProvider(AuthContextService)
    .useValue({
      checkSub: () => TEST_USER_ID,
      getSub: () => TEST_USER_ID,
      getOrganizationId: () => TEST_ORG_ID,
    });

  const moduleRef = cb ? await cb(m) : await m.compile();

  const adapter = new FastifyAdapter();

  const app = moduleRef.createNestApplication(adapter);
  app.enableShutdownHooks();
  await app.init();

  return app;
};
