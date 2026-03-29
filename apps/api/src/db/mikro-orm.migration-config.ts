import { join } from 'node:path';

import { Migrator } from '@mikro-orm/migrations';
import { defineConfig, UnderscoreNamingStrategy } from '@mikro-orm/postgresql';

/**
 * Minimal MikroORM config for running migrations via the CLI.
 *
 * Used by: migration:run (up) and migration:revert (down).
 *
 * No entity discovery, no app dependencies — just what the Migrator needs.
 * Reads connection info directly from process.env so this file has zero
 * imports from the app's environment layer.
 */
export default defineConfig({
  clientUrl:
    process.env.POSTGRES_URL ||
    'postgresql://postgres:postgres@localhost:5439/geniro',
  host: process.env.POSTGRES_HOST || undefined,
  port: process.env.POSTGRES_PORT
    ? Number(process.env.POSTGRES_PORT)
    : undefined,
  user: process.env.POSTGRES_USERNAME || undefined,
  dbName: process.env.POSTGRES_DATABASE || undefined,
  password: process.env.POSTGRES_PASSWORD || undefined,
  schema: process.env.POSTGRES_SCHEMA || undefined,
  namingStrategy: UnderscoreNamingStrategy,
  entities: [],
  discovery: { warnWhenNoEntities: false },
  extensions: [Migrator],
  migrations: {
    path: join(__dirname, 'migrations'),
    pathTs: join(__dirname, 'migrations'),
    tableName: 'mikro_orm_migrations',
    transactional: true,
  },
  driverOptions: process.env.POSTGRES_SSL
    ? { connection: { ssl: true } }
    : undefined,
});
