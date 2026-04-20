// Hand-written (dev environment cannot reach the migration generator) — only
// touches the three new runtime_instances columns. See G4 in
// .geniro/knowledge/gotchas/instruction-assembly-gotchas.jsonl for the
// pre-existing runtime_instances enum/CHECK-constraint drift the generator
// would otherwise emit alongside any intended change.
import { Migration } from '@mikro-orm/migrations';

export class Migration20260419183421 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'runtime_instances_starting_phase_enum') THEN
          CREATE TYPE "public"."runtime_instances_starting_phase_enum" AS ENUM (
            'PullingImage', 'ContainerCreated', 'InitScript', 'Ready'
          );
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'runtime_instances_error_code_enum') THEN
          CREATE TYPE "public"."runtime_instances_error_code_enum" AS ENUM (
            'ProviderAuth', 'RuntimeIo', 'ImagePull', 'Timeout', 'Unknown'
          );
        END IF;
      END $$;
    `);

    this.addSql(
      `alter table "runtime_instances" add column if not exists "starting_phase" "public"."runtime_instances_starting_phase_enum";`,
    );
    this.addSql(
      `alter table "runtime_instances" add column if not exists "error_code" "public"."runtime_instances_error_code_enum";`,
    );
    this.addSql(
      `alter table "runtime_instances" add column if not exists "last_error" text;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "runtime_instances" drop column if exists "last_error";`,
    );
    this.addSql(
      `alter table "runtime_instances" drop column if exists "error_code";`,
    );
    this.addSql(
      `alter table "runtime_instances" drop column if exists "starting_phase";`,
    );
    this.addSql(
      `drop type if exists "public"."runtime_instances_error_code_enum";`,
    );
    this.addSql(
      `drop type if exists "public"."runtime_instances_starting_phase_enum";`,
    );
  }
}
