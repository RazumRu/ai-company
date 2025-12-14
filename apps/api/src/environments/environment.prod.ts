import { getEnv } from '@packages/common';

export const environment = () =>
  ({
    env: getEnv('NODE_ENV', 'production'),
    tag: getEnv('TF_IMAGE_TAG', 'none'),
    appName: getEnv('TF_APP_NAME', 'company-ai-api'),
    logLevel: getEnv('LOG_LEVEL', 'error'),
    lodDbQueries: getEnv('LOG_DB_QUERIES', false),
    prettyLog: getEnv('PRETTY_LOGS', false),
    sentryDsn: getEnv('SENTRY_DSN'),

    // server
    globalPrefix: getEnv('GLOBAL_PATH_PREFIX', 'api'),
    swaggerPath: getEnv('SWAGGER_PATH'),
    port: +getEnv('HTTP_PORT', '5000'),

    // auth
    authDevMode: getEnv('AUTH_DEV_MODE', false),
    keycloakUrl: getEnv('KEYCLOAK_URL'),
    keycloakRealm: getEnv('KEYCLOAK_REALM', 'company-ai'),

    // connections
    postgresUrl: getEnv('POSTGRES_URL'),
    postgresHost: getEnv('POSTGRES_HOST'),
    postgresPort: getEnv('POSTGRES_PORT'),
    postgresUsername: getEnv('POSTGRES_USERNAME'),
    postgresPassword: getEnv('POSTGRES_PASSWORD'),
    postgresDatabase: getEnv('POSTGRES_DATABASE'),
    postgresRunMigrations: getEnv('POSTGRES_RUN_MIGRATIONS', true),
    llmBaseUrl: getEnv('LLM_BASE_URL'),
    redisUrl: getEnv('REDIS_URL'),

    // misc
    litellmMasterKey: getEnv('LITELLM_MASTER_KEY'),
    dockerSocket: getEnv('DOCKER_SOCKET', '/var/run/docker.sock'),
    dockerRuntimeImage: getEnv(
      'DOCKER_RUNTIME_IMAGE',
      'ai-company-runtime:latest',
    ),
    tavilyApiKey: getEnv('TAVILY_API_KEY'),
    restoreGraphs: getEnv('RESTORE_GRAPHS', true),
  }) as const satisfies Record<string, string | number | boolean>;
