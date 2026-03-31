import { Migration } from '@mikro-orm/migrations';

export class Migration20260329165904 extends Migration {
  override up(): void | Promise<void> {
    this.addSql(
      `alter table "graphs" alter column "status" set default 'created';`,
    );

    this.addSql(
      `alter table "graph_revisions" alter column "status" set default 'pending';`,
    );

    this.addSql(
      `alter table "runtime_instances" alter column "status" set default 'Starting';`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table "graph_revisions" alter column "status" drop default;`,
    );

    this.addSql(`alter table "graphs" alter column "status" drop default;`);

    this.addSql(
      `alter table "runtime_instances" alter column "status" drop default;`,
    );
  }
}
