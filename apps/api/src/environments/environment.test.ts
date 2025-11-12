import { getEnv } from '@packages/common';

import { environment as devEnvironment } from './environment.dev';

export const environment = () =>
  ({
    ...devEnvironment(),
    env: getEnv('NODE_ENV', 'test'),
    logLevel: getEnv('LOG_LEVEL', 'debug'),
    postgresRunMigrations: getEnv('POSTGRES_RUN_MIGRATIONS', false),
    restoreGraphs: getEnv('RESTORE_GRAPHS', false),
  }) as const satisfies Record<string, string | number | boolean>;
