import { getEnv } from '@packages/common';

import { environment as devEnvironment } from './environment.dev';

export const environment = () =>
  ({
    ...devEnvironment(),
    env: getEnv('NODE_ENV', 'test'),
    logLevel: getEnv('LOG_LEVEL', 'debug'),
    llmUseOfflineModel: false,
    postgresRunMigrations: getEnv('POSTGRES_RUN_MIGRATIONS', false),
    restoreGraphs: getEnv('RESTORE_GRAPHS', false),
    knowledgeReindexOnStartup: getEnv('KNOWLEDGE_REINDEX_ON_STARTUP', false),
    knowledgeChunksCollection: getEnv(
      'KNOWLEDGE_CHUNKS_COLLECTION',
      'knowledge_chunks_test',
    ),

    // credential encryption (test default key - DO NOT use in production)
    credentialEncryptionKey: getEnv(
      'CREDENTIAL_ENCRYPTION_KEY',
      'a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890',
    ),
  }) as const satisfies Record<string, string | number | boolean>;
