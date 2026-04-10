import { Migration } from '@mikro-orm/migrations';

export class Migration20260410111821 extends Migration {
  override up(): void | Promise<void> {
    this.addSql(
      `create table "secrets" ("id" uuid not null default gen_random_uuid(), "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, "created_by" varchar(255) not null, "project_id" uuid not null, "name" varchar(255) not null, "description" text null, primary key ("id"));`,
    );
    this.addSql(
      `create index "secrets_created_by_index" on "secrets" ("created_by");`,
    );
    this.addSql(
      `create index "secrets_project_id_index" on "secrets" ("project_id");`,
    );
    this.addSql(
      `alter table "secrets" add constraint "secrets_project_id_name_unique" unique ("project_id", "name");`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "secrets" cascade;`);
  }
}
