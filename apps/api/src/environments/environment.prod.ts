import { getEnv } from '@packages/common';

export const environment = () =>
  ({
    env: getEnv('NODE_ENV', 'production'),
    tag: getEnv('TF_IMAGE_TAG', 'none'),
    appName: getEnv('TF_APP_NAME', 'lusora-api'),
    logLevel: getEnv('LOG_LEVEL', 'error'),
    lodDbQueries: getEnv('LOG_DB_QUERIES', false),
    prettyLog: getEnv('PRETTY_LOGS', false),
    sentryDsn: getEnv('SENTRY_DSN'),

    // server
    globalPrefix: <string>getEnv('GLOBAL_PATH_PREFIX', 'api'),
    swaggerPath: getEnv('SWAGGER_PATH'),
    port: +getEnv('HTTP_PORT', '5000'),

    // auth
    authDevMode: getEnv('AUTH_DEV_MODE', false),
    keycloakUrl: getEnv('KEYCLOAK_URL'),
    keycloakRealm: getEnv('KEYCLOAK_REALM', 'lusora'),

    // connections
    postgresUrl: getEnv('POSTGRES_URL'),
    llmBaseUrl: getEnv('LLM_BASE_URL'),

    // misc
    litellmMasterKey: getEnv('LITELLM_MASTER_KEY'),
    dockerSocket: getEnv('DOCKER_SOCKET', '/var/run/docker.sock'),
    dockerRuntimeImage: getEnv('DOCKER_RUNTIME_IMAGE', 'node:22-alpine'),
    tavilyApiKey: getEnv('TAVILY_API_KEY'),
  }) as const satisfies Record<string, string | number | boolean>;
