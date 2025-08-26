import { buildBootstrapper, LogLevel } from '@packages/common';
import {
  buildAuthExtension,
  buildHttpServerExtension,
  KeycloakProvider,
} from '@packages/http-server';
import { buildMetricExtension } from '@packages/metrics';
import { buildTypeormExtension } from '@packages/typeorm';

import { AppModule } from './app.module';
import typeormconfig from './db/typeormconfig';
import { environment } from './environments';

const bootstrapper = buildBootstrapper({
  environment: environment.env,
  appName: environment.appName,
  appVersion: environment.tag,
});

bootstrapper.addExtension(
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

bootstrapper.addExtension(
  buildAuthExtension({
    devMode: environment.authDevMode,
    provider: new KeycloakProvider({
      url: environment.keycloakUrl,
      realms: [environment.keycloakRealm],
    }),
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
