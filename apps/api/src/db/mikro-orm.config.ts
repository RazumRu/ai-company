import { Migrator } from '@mikro-orm/migrations';
import { defineConfig, UnderscoreNamingStrategy } from '@mikro-orm/postgresql';

import { environment } from '../environments';

const config = defineConfig({
  clientUrl: environment.postgresUrl || undefined,
  host: environment.postgresHost || undefined,
  port: Number(environment.postgresPort ?? 5432),
  user: environment.postgresUsername || undefined,
  dbName: environment.postgresDatabase || undefined,
  password: environment.postgresPassword || undefined,
  schema: environment.postgresSchema || undefined,
  entities: ['dist/**/*.entity.js'],
  entitiesTs: ['src/**/*.entity.ts'],
  namingStrategy: UnderscoreNamingStrategy,
  extensions: [Migrator],
  migrations: {
    path: 'dist/db/migrations',
    pathTs: 'src/db/migrations',
    tableName: 'mikro_orm_migrations',
    transactional: true,
  },
  driverOptions: environment.postgresSsl
    ? { connection: { ssl: true } }
    : undefined,
  schemaGenerator: environment.postgresSchema
    ? { ignoreSchema: [] }
    : undefined,
  debug: environment.lodDbQueries ?? false,
});

export default config;
