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
  }) as const satisfies Record<string, string | number | boolean>;
