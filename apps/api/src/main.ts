import { INestApplication } from '@nestjs/common';
import { buildBootstrapper, LogLevel } from '@packages/common';
import {
  buildAuthExtension,
  buildHttpServerExtension,
  KeycloakProvider,
  ZitadelProvider,
} from '@packages/http-server';
import { buildMetricExtension } from '@packages/metrics';
import { buildTypeormExtension } from '@packages/typeorm';

import { AppModule } from './app.module';
import { AppContextStorage } from './auth/app-context-storage';
import typeormconfig from './db/typeormconfig';
import { environment } from './environments';
import { RedisIoAdapter } from './v1/notification-handlers/gateways/redis-io.adapter';

const bootstrapper = buildBootstrapper({
  environment: environment.env,
  appName: environment.appName,
  appVersion: environment.tag,
});

bootstrapper.addExtension(
  buildHttpServerExtension(
    {
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
    },
    (app: INestApplication) => {
      const adapter = new RedisIoAdapter(app, environment.redisUrl);
      // Redis connection happens asynchronously after server start.
      // This is intentional: the appChangeCb is synchronous, and single-instance
      // mode works correctly until the adapter connects.
      void adapter.connectToRedis();
      app.useWebSocketAdapter(adapter);

      return app;
    },
  ),
);

const authProviderInstance =
  environment.authProvider === 'zitadel'
    ? new ZitadelProvider({
        url: environment.zitadelUrl,
        issuer: environment.zitadelIssuer,
      })
    : new KeycloakProvider({
        url: environment.keycloakUrl,
        realms: [environment.keycloakRealm],
      });

bootstrapper.addExtension(
  buildAuthExtension({
    devMode: environment.authDevMode,
    provider: authProviderInstance,
    storage: AppContextStorage,
  }),
);

bootstrapper.addExtension(buildMetricExtension());
bootstrapper.addExtension(buildTypeormExtension(typeormconfig));

bootstrapper.setupLogger({
  prettyPrint: environment.prettyLog,
  level: <LogLevel>environment.logLevel,
  sentryDsn: environment.sentryDsn,
});

bootstrapper.addModules([AppModule]);

// Initialize the application
bootstrapper.init().catch((err) => {
  console.error('Failed to bootstrap application', err);
  process.exit(1);
});
