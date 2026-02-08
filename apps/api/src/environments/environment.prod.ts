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
    postgresSchema: getEnv('POSTGRES_SCHEMA'),
    postgresSsl: getEnv('POSTGRES_SSL', false),
    postgresRunMigrations: getEnv('POSTGRES_RUN_MIGRATIONS', true),
    llmBaseUrl: getEnv('LLM_BASE_URL'),
    redisUrl: getEnv('REDIS_URL'),
    qdrantUrl: getEnv('QDRANT_URL'),
    qdrantApiKey: getEnv('QDRANT_API_KEY'),

    // misc
    litellmMasterKey: getEnv('LITELLM_MASTER_KEY'),
    llmRequestTimeoutMs: +getEnv('LLM_REQUEST_TIMEOUT_MS', '600000'),
    llmLargeModel: getEnv('LLM_LARGE_MODEL', 'openai/gpt-5.2'),
    llmLargeCodeModel: getEnv('LLM_LARGE_CODE_MODEL', 'gpt-5.3-codex'),
    llmMiniCodeModel: getEnv('LLM_MINI_CODE_MODEL', 'gpt-5.1-codex-mini'),
    llmMiniModel: getEnv('LLM_MINI_MODEL', 'gpt-5-mini'),
    llmUseOfflineModel: getEnv('LLM_USE_OFFLINE_MODEL', false),
    llmOfflineCodingModel: getEnv('LLM_OFFLINE_CODING_MODEL', 'glm-4.7-flash'),
    llmOfflineCodingMiniModel: getEnv(
      'LLM_OFFLINE_CODING_MINI_MODEL',
      'qwen2.5-coder:7b',
    ),
    llmOfflineEmbeddingModel: getEnv(
      'LLM_OFFLINE_EMBEDDING_MODEL',
      'qwen3-embedding:4b',
    ),
    llmOfflineMiniModel: getEnv(
      'LLM_OFFLINE_MINI_MODEL',
      'phi3.5:3.8b-mini-instruct-q4_K_M',
    ),
    llmEmbeddingModel: getEnv(
      'LLM_EMBEDDING_MODEL',
      'openai/text-embedding-3-small',
    ),
    llmNoReasoningModels: getEnv('LLM_NO_REASONING_MODELS', 'qwen3-coder:30b'),
    knowledgeChunkMaxTokens: +getEnv('KNOWLEDGE_CHUNK_MAX_TOKENS', '500'),
    knowledgeChunkMaxCount: +getEnv('KNOWLEDGE_CHUNK_MAX_COUNT', '100'),
    knowledgeReindexOnStartup: getEnv('KNOWLEDGE_REINDEX_ON_STARTUP', true),
    knowledgeChunksCollection: getEnv(
      'KNOWLEDGE_CHUNKS_COLLECTION',
      'knowledge_chunks',
    ),
    // --- Credential encryption ---
    // Required: 64-char hex string (32 bytes) for AES-256-GCM encryption
    // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    credentialEncryptionKey: getEnv('CREDENTIAL_ENCRYPTION_KEY'),

    // --- Codebase indexing ---
    codebaseIndexTokenThreshold: +getEnv(
      'CODEBASE_INDEX_TOKEN_THRESHOLD',
      '50000',
    ),
    codebaseUuidNamespace: getEnv(
      'CODEBASE_UUID_NAMESPACE',
      '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
    ),
    codebaseEmbeddingMaxTokens: +getEnv(
      'CODEBASE_EMBEDDING_MAX_TOKENS',
      '15000',
    ),
    codebaseEmbeddingConcurrency: +getEnv(
      'CODEBASE_EMBEDDING_CONCURRENCY',
      '2',
    ),
    codebaseChunkTargetTokens: +getEnv('CODEBASE_CHUNK_TARGET_TOKENS', '250'),
    codebaseChunkOverlapTokens: +getEnv('CODEBASE_CHUNK_OVERLAP_TOKENS', '30'),
    codebaseMaxFileBytes: +getEnv('CODEBASE_MAX_FILE_BYTES', '1048576'),

    // LLM model defaults for tools (do not override per-call)
    dockerSocket: getEnv('DOCKER_SOCKET', '/var/run/docker.sock'),
    dockerRuntimeImage: getEnv(
      'DOCKER_RUNTIME_IMAGE',
      'ai-company-runtime:latest',
    ),
    dockerRegistryMirror: getEnv('DOCKER_REGISTRY_MIRROR'),
    dockerInsecureRegistry: getEnv('DOCKER_INSECURE_REGISTRY'),
    tavilyApiKey: getEnv('TAVILY_API_KEY'),
    restoreGraphs: getEnv('RESTORE_GRAPHS', true),
    runtimeCleanupIntervalMs: +getEnv('RUNTIME_CLEANUP_INTERVAL_MS', '300000'),
    runtimeIdleThresholdMs: +getEnv('RUNTIME_IDLE_THRESHOLD_MS', '1800000'),
  }) as const satisfies Record<string, string | number | boolean>;
