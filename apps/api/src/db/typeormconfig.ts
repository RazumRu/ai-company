import { DataSource } from 'typeorm';

import { environment } from '../environments';

export default new DataSource({
  type: 'postgres',
  url: environment.postgresUrl || undefined,
  host: environment.postgresHost || undefined,
  port: Number(environment.postgresPort ?? 5432),
  username: environment.postgresUsername || undefined,
  database: environment.postgresDatabase || undefined,
  password: environment.postgresPassword || undefined,
  schema: environment.postgresSchema || undefined,
  entities: [`${__dirname}/../**/*.entity{.ts,.js}`],
  migrations: environment.postgresRunMigrations
    ? [`${__dirname}/migrations/**/*{.ts,.js}`]
    : undefined,
  extra: environment.postgresSchema
    ? {
        options: `-c search_path=${environment.postgresSchema},public`,
      }
    : undefined,
  ssl: environment.postgresSsl,
  synchronize: false,
  dropSchema: false,
  logging: environment.lodDbQueries,
  migrationsRun: environment.postgresRunMigrations,
  migrationsTransactionMode: 'each',
});
