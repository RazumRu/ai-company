import { Client } from 'pg';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

import migrationConfig from '../../db/mikro-orm.migration-config';

const WORKER_COUNT = 5;

/**
 * Boot ephemeral Postgres / Redis / Qdrant containers, run MikroORM migrations
 * against the base DB once, then clone that DB into one DB per vitest worker so
 * workers can run in parallel without state collisions.
 *
 * The setup is intentionally synchronous-ish: every step that mutates env vars
 * or schema state happens before vitest spawns its workers, so the worker-side
 * `setup.ts` can read deterministic values from `process.env`.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
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
  const containers: StartedTestContainer[] = [
    postgresContainer,
    redisContainer,
    qdrantContainer,
  ];

  const postgresUrl = `postgresql://postgres:postgres@${postgresContainer.getHost()}:${postgresContainer.getMappedPort(
    5432,
  )}/geniro`;
  const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
  const qdrantUrl = `http://${qdrantContainer.getHost()}:${qdrantContainer.getMappedPort(6333)}`;

  process.stdout.write(
    `[integration] containers ready in ${Date.now() - startedAt}ms\n`,
  );

  process.env.POSTGRES_URL = postgresUrl;
  process.env.REDIS_URL = redisUrl;
  process.env.QDRANT_URL = qdrantUrl;

  await runMigrations(postgresUrl);

  const workerDbNames = await cloneDatabasePerWorker(postgresUrl, WORKER_COUNT);

  process.env.INTEGRATION_BASE_POSTGRES_URL = postgresUrl;
  process.env.INTEGRATION_WORKER_DB_NAMES = workerDbNames.join(',');

  return async () => {
    await dropWorkerDatabases(postgresUrl, workerDbNames);
    await Promise.allSettled(containers.map((c) => c.stop()));
  };
}

const runMigrations = async (postgresUrl: string): Promise<void> => {
  const previous = process.env.POSTGRES_URL;
  process.env.POSTGRES_URL = postgresUrl;
  try {
    const { MikroORM } = await import('@mikro-orm/postgresql');
    const { Migrator } = await import('@mikro-orm/migrations');
    const orm = await MikroORM.init({
      ...migrationConfig,
      extensions: [Migrator],
      clientUrl: postgresUrl,
      migrations: {
        ...migrationConfig.migrations,
        snapshot: false,
      },
    });
    try {
      await orm.migrator.up();
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
