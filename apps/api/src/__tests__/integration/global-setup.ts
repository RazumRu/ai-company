import { Client } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

import mikroOrmConfig from '../../db/mikro-orm.config';
import migrationConfig from '../../db/mikro-orm.migration-config';

interface IntegrationGlobalState {
  containers: StartedTestContainer[];
  postgresUrl: string;
  workerDbNames: string[];
}

const GLOBAL_STATE_KEY = 'integrationGlobalState';

/**
 * Boot ephemeral Postgres / Redis / Qdrant containers (or reuse local services
 * when `INTEGRATION_USE_LOCAL_DEPS=1`), run MikroORM migrations once against
 * the base DB, then clone that DB into one DB per vitest worker so workers
 * can run in parallel without state collisions.
 *
 * The setup is intentionally synchronous-ish: every step that mutates env
 * vars or schema state happens before vitest spawns its workers, so the
 * worker-side `setup.ts` can read deterministic values from `process.env`.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  // Skip entirely when only unit tests are running. `test:unit` is wired with
  // `--exclude='src/**/*.int.ts'`, so checking argv keeps unit-only runs free
  // of container/DB overhead.
  if (isUnitOnlyRun()) {
    return async () => {};
  }

  const useLocalDeps = await resolveUseLocalDeps();
  const containers: StartedTestContainer[] = [];

  let postgresUrl: string;
  let redisUrl: string;
  let qdrantUrl: string;

  if (useLocalDeps) {
    postgresUrl =
      process.env.POSTGRES_URL ||
      'postgresql://postgres:postgres@localhost:5439/geniro';
    redisUrl = process.env.REDIS_URL || 'redis://localhost:6380';
    qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    process.stdout.write(
      `[integration] using local deps (postgres=${postgresUrl})\n`,
    );
  } else {
    // Ryuk (the testcontainers cleanup sidecar) tries to bind-mount the
    // Docker/Podman socket; on Podman/Mac this fails with
    // "operation not supported". Disabling Ryuk leaves cleanup to the
    // teardown function and works reliably across Docker Desktop, Podman
    // machine, and Colima. Only set when not already overridden.
    if (process.env.TESTCONTAINERS_RYUK_DISABLED === undefined) {
      process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';
    }
    const startedAt = Date.now();
    const [postgresContainer, redisContainer, qdrantContainer] =
      await Promise.all([
        new GenericContainer('pgvector/pgvector:pg17')
          .withEnvironment({
            POSTGRES_USER: 'postgres',
            POSTGRES_PASSWORD: 'postgres',
            POSTGRES_DB: 'geniro',
          })
          .withExposedPorts(5432)
          .withWaitStrategy(
            Wait.forLogMessage(
              /database system is ready to accept connections/,
              2,
            ),
          )
          .start(),
        new GenericContainer('redis:7-alpine')
          .withExposedPorts(6379)
          .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
          .start(),
        new GenericContainer('qdrant/qdrant:latest')
          .withExposedPorts(6333)
          .withWaitStrategy(Wait.forLogMessage(/Qdrant HTTP listening/))
          .start(),
      ]);
    containers.push(postgresContainer, redisContainer, qdrantContainer);

    postgresUrl = `postgresql://postgres:postgres@${postgresContainer.getHost()}:${postgresContainer.getMappedPort(
      5432,
    )}/geniro`;
    redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    qdrantUrl = `http://${qdrantContainer.getHost()}:${qdrantContainer.getMappedPort(6333)}`;

    process.stdout.write(
      `[integration] containers ready in ${Date.now() - startedAt}ms\n`,
    );
  }

  process.env.POSTGRES_URL = postgresUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.QDRANT_URL = qdrantUrl;

  process.env.INTEGRATION_USE_LOCAL_DEPS = useLocalDeps ? '1' : '0';

  await ensureRequiredExtensions(postgresUrl);
  if (useLocalDeps) {
    // Local Postgres already has the schema applied via `pnpm migration:run`.
    // Skip the migrate-or-create step to avoid double-applying or failing on
    // already-applied DDL.
    await ensureMigrationsApplied(postgresUrl);
  } else {
    // Fresh container DB: build the schema directly from entity metadata.
    // The migration history accumulated drops/renames over time that fail on
    // pristine databases, so SchemaGenerator is the reliable source of truth.
    await createSchemaFromEntities(postgresUrl);
  }

  const workerCount = resolveWorkerCount();
  const workerDbNames = await cloneDatabasePerWorker(postgresUrl, workerCount);

  process.env.INTEGRATION_BASE_POSTGRES_URL = postgresUrl;
  process.env.INTEGRATION_WORKER_DB_NAMES = workerDbNames.join(',');

  const state: IntegrationGlobalState = {
    containers,
    postgresUrl,
    workerDbNames,
  };
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_STATE_KEY] = state;

  return async () => {
    await dropWorkerDatabases(postgresUrl, workerDbNames);
    if (containers.length > 0) {
      await Promise.allSettled(containers.map((c) => c.stop()));
    }
  };
}

const isUnitOnlyRun = (): boolean => {
  const argv = process.argv.join(' ');
  return (
    argv.includes("--exclude='src/**/*.int.ts'") ||
    argv.includes('--exclude=src/**/*.int.ts')
  );
};

/**
 * Use local `pnpm deps:up` services when reachable; otherwise boot
 * testcontainers. Honor explicit `INTEGRATION_USE_LOCAL_DEPS=1|0` overrides.
 *
 * Auto-detection avoids the env-var ceremony while keeping CI hermetic — CI
 * runners don't have local Postgres on 5439, so the probe fails fast and
 * testcontainers boots as before.
 */
const resolveUseLocalDeps = async (): Promise<boolean> => {
  const explicit = process.env.INTEGRATION_USE_LOCAL_DEPS;
  if (explicit === '1') {
    return true;
  }
  if (explicit === '0') {
    return false;
  }
  const probeUrl =
    process.env.POSTGRES_URL ||
    'postgresql://postgres:postgres@localhost:5439/geniro';
  return await isPostgresReachable(probeUrl);
};

const isPostgresReachable = async (postgresUrl: string): Promise<boolean> => {
  const client = new Client({
    connectionString: postgresUrl,
    connectionTimeoutMillis: 1_500,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
};

const resolveWorkerCount = (): number => {
  const explicit = process.env.INTEGRATION_WORKER_COUNT;
  if (explicit) {
    const parsed = Number(explicit);
    if (!Number.isFinite(parsed) || parsed < 1) {
      throw new Error(
        `Invalid INTEGRATION_WORKER_COUNT=${explicit}; must be a positive integer`,
      );
    }
    return Math.floor(parsed);
  }
  return 4;
};

const ensureRequiredExtensions = async (postgresUrl: string): Promise<void> => {
  const client = new Client({ connectionString: postgresUrl });
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
    await client.query('CREATE EXTENSION IF NOT EXISTS "vector"');
  } finally {
    await client.end();
  }
};

const createSchemaFromEntities = async (postgresUrl: string): Promise<void> => {
  const previous = process.env.POSTGRES_URL;
  process.env.POSTGRES_URL = postgresUrl;
  try {
    const { MikroORM } = await import('@mikro-orm/postgresql');
    const orm = await MikroORM.init({
      ...mikroOrmConfig,
      clientUrl: postgresUrl,
      ensureDatabase: false,
    });
    try {
      await orm.schema.create();
    } finally {
      await orm.close(true);
    }
  } finally {
    if (previous === undefined) {
      delete process.env.POSTGRES_URL;
    } else {
      process.env.POSTGRES_URL = previous;
    }
  }
};

const ensureMigrationsApplied = async (postgresUrl: string): Promise<void> => {
  const previous = process.env.POSTGRES_URL;
  process.env.POSTGRES_URL = postgresUrl;
  try {
    const { MikroORM } = await import('@mikro-orm/postgresql');
    const { Migrator } = await import('@mikro-orm/migrations');
    const orm = await MikroORM.init({
      ...migrationConfig,
      extensions: [Migrator],
      clientUrl: postgresUrl,
    });
    try {
      const migrator = orm.migrator;
      const pending = await migrator.getPending();
      if (pending.length === 0) {
        return;
      }
      try {
        await migrator.up();
      } catch (err) {
        process.stderr.write(
          `[integration] migration failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        if (err instanceof Error && err.stack) {
          process.stderr.write(`${err.stack}\n`);
        }
        throw err;
      }
    } finally {
      await orm.close(true);
    }
  } finally {
    if (previous === undefined) {
      delete process.env.POSTGRES_URL;
    } else {
      process.env.POSTGRES_URL = previous;
    }
  }
};

const cloneDatabasePerWorker = async (
  baseUrl: string,
  workerCount: number,
): Promise<string[]> => {
  if (workerCount === 1) {
    return [extractDatabaseName(baseUrl)];
  }
  const adminUrl = withDatabase(baseUrl, 'postgres');
  const baseDbName = extractDatabaseName(baseUrl);
  const names: string[] = [];

  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (let i = 1; i <= workerCount; i++) {
      const dbName = `${baseDbName}_w${i}`;
      names.push(dbName);
      await client.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await client.query(
        `CREATE DATABASE "${dbName}" TEMPLATE "${baseDbName}"`,
      );
    }
  } finally {
    await client.end();
  }

  return names;
};

const dropWorkerDatabases = async (
  baseUrl: string,
  workerDbNames: string[],
): Promise<void> => {
  if (workerDbNames.length <= 1) {
    return;
  }
  const adminUrl = withDatabase(baseUrl, 'postgres');
  const client = new Client({ connectionString: adminUrl });
  try {
    await client.connect();
  } catch {
    return;
  }
  try {
    for (const dbName of workerDbNames) {
      try {
        await client.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [dbName],
        );
        await client.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      } catch {
        // best-effort teardown
      }
    }
  } finally {
    await client.end();
  }
};

const extractDatabaseName = (url: string): string => {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^\//, '');
  if (!path) {
    throw new Error(`Postgres URL has no database segment: ${url}`);
  }
  return path;
};

const withDatabase = (url: string, dbName: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
};
