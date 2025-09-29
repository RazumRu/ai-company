import { getEnv } from '@packages/common';

import { environment as prodEnvironment } from './environment.prod';

export const environment = () =>
  ({
    ...prodEnvironment(),
    env: getEnv('NODE_ENV', 'development'),
    logLevel: getEnv('LOG_LEVEL', 'debug'),
    prettyLog: getEnv('PRETTY_LOGS', true),
    sentryDsn: getEnv('SENTRY_DSN'),

    // server
    port: +getEnv('HTTP_PORT', '5000'),
    swaggerPath: getEnv('SWAGGER_PATH', '/swagger-api'),

    // connections
    postgresUrl: getEnv(
      'POSTGRES_URL',
      'postgresql://postgres:postgres@localhost:5439/ai_company',
    ),
    llmBaseUrl: getEnv('LLM_BASE_URL', 'http://localhost:4000'),

    // misc
    litellmMasterKey: getEnv('LITELLM_MASTER_KEY', 'master'),

    // auth
    authDevMode: getEnv('AUTH_DEV_MODE', true),
    keycloakUrl: getEnv('KEYCLOAK_URL', 'http://localhost:8082'),
    keycloakRealm: getEnv('KEYCLOAK_REALM', 'ai-company'),
  }) as const satisfies Record<string, string | number | boolean>;
