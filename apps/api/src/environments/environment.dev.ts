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
      'postgresql://postgres:postgres@localhost:5439/geniro',
    ),
    llmBaseUrl: getEnv('LLM_BASE_URL', 'http://localhost:4000'),
    redisUrl: getEnv('REDIS_URL', 'redis://localhost:6379'),
    qdrantUrl: getEnv('QDRANT_URL', 'http://localhost:6333'),
    qdrantApiKey: getEnv('QDRANT_API_KEY'),

    // misc
    litellmMasterKey: getEnv('LITELLM_MASTER_KEY', 'master'),
    llmRequestTimeoutMs: +getEnv('LLM_REQUEST_TIMEOUT_MS', '600000'),

    // auth
    authDevMode: getEnv('AUTH_DEV_MODE', true),
    keycloakUrl: getEnv('KEYCLOAK_URL', 'http://localhost:8082'),
    keycloakRealm: getEnv('KEYCLOAK_REALM', 'geniro'),

    // docker registry mirror (for DinD)
    dockerRegistryMirror: getEnv(
      'DOCKER_REGISTRY_MIRROR',
      'http://registry-mirror:5000',
    ),
    dockerInsecureRegistry: getEnv(
      'DOCKER_INSECURE_REGISTRY',
      'registry-mirror:5000',
    ),
    knowledgeChunksCollection: getEnv(
      'KNOWLEDGE_CHUNKS_COLLECTION',
      'knowledge_chunks',
    ),
    knowledgeReindexOnStartup: getEnv('KNOWLEDGE_REINDEX_ON_STARTUP', true),

    // credential encryption (dev default key - DO NOT use in production)
    credentialEncryptionKey: getEnv(
      'CREDENTIAL_ENCRYPTION_KEY',
      '7851424f98bd5e2a8941af9c4a43aea5e547790176d9689554ddbbfcf94bd8fa',
    ),
  }) as const satisfies Record<string, string | number | boolean>;
