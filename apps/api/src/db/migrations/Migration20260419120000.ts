// Hand-written migration: the local docker stack is unavailable in this
// environment, so `pnpm run migration:generate` can't introspect the live
// schema. This file was authored to match the SQL the generator would emit
// for the ThreadStoreEntryEntity introduction.
import { Migration } from '@mikro-orm/migrations';

export class Migration20260419120000 extends Migration {
  override up(): void | Promise<void> {
    this.addSql(
      `create table "thread_store_entries" ("created_at" timestamptz(6) not null default now(), "updated_at" timestamptz(6) not null default now(), "deleted_at" timestamptz(6) null, "created_by" varchar(255) not null, "project_id" uuid not null, "id" uuid not null default gen_random_uuid(), "thread_id" uuid not null, "namespace" varchar(128) not null, "key" varchar(256) not null, "value" jsonb not null, "mode" text check ("mode" in ('kv', 'append')) not null, "author_agent_id" varchar(128) null, "tags" text[] null, constraint "thread_store_entries_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "thread_store_entries_created_by_index" on "thread_store_entries" ("created_by");`,
    );
    this.addSql(
      `create index "thread_store_entries_project_id_index" on "thread_store_entries" ("project_id");`,
    );
    this.addSql(
      `create index "thread_store_entries_thread_ns_idx" on "thread_store_entries" ("thread_id", "namespace");`,
    );
    this.addSql(
      `alter table "thread_store_entries" add constraint "thread_store_entries_thread_ns_key_uniq" unique ("thread_id", "namespace", "key");`,
    );
    this.addSql(
      `alter table "thread_store_entries" add constraint "thread_store_entries_thread_id_foreign" foreign key ("thread_id") references "threads" ("id") on update cascade on delete cascade;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "thread_store_entries" cascade;`);
  }
}
