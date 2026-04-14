import { Migration } from '@mikro-orm/migrations';

export class Migration20260414095208 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'runtime_instances_type_enum') THEN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_enum e
            JOIN pg_type t ON e.enumtypid = t.oid
            WHERE t.typname = 'runtime_instances_type_enum'
              AND e.enumlabel = 'K8s'
          ) THEN
            ALTER TYPE "public"."runtime_instances_type_enum" ADD VALUE 'K8s';
          END IF;
        ELSE
          CREATE TYPE "public"."runtime_instances_type_enum" AS ENUM ('Docker', 'Daytona', 'K8s');
          ALTER TABLE "runtime_instances"
            DROP CONSTRAINT IF EXISTS "runtime_instances_type_check";
          ALTER TABLE "runtime_instances"
            ALTER COLUMN "type" TYPE "public"."runtime_instances_type_enum"
            USING ("type"::text::"public"."runtime_instances_type_enum");
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'runtime_instances_status_enum') THEN
          CREATE TYPE "public"."runtime_instances_status_enum" AS ENUM ('Starting', 'Running', 'Stopping', 'Stopped', 'Failed');
          ALTER TABLE "runtime_instances"
            DROP CONSTRAINT IF EXISTS "runtime_instances_status_check";
          ALTER TABLE "runtime_instances"
            ALTER COLUMN "status" DROP DEFAULT;
          ALTER TABLE "runtime_instances"
            ALTER COLUMN "status" TYPE "public"."runtime_instances_status_enum"
            USING ("status"::text::"public"."runtime_instances_status_enum");
          ALTER TABLE "runtime_instances"
            ALTER COLUMN "status" SET DEFAULT 'Starting'::"public"."runtime_instances_status_enum";
        END IF;
      END $$;
    `);
  }

  override async down(): Promise<void> {
    // PostgreSQL cannot remove values from an enum type, so reverting the
    // 'K8s' addition is a no-op. The CHECK-constraint fallback is not
    // recreated either: production uses the native ENUM path, and dev
    // environments that reach this down() can regenerate from the snapshot.
  }
}
