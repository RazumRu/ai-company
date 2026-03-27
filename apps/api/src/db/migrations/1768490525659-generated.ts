import { Migration } from '@mikro-orm/migrations';

export class Generated1768490525659 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "runtime_instances" DROP COLUMN "metadata"
        `);
    this.addSql(`
            ALTER TABLE "runtime_instances" DROP COLUMN "version"
        `);
    this.addSql(`
            ALTER TABLE "runtime_instances"
            ADD "temporary" boolean NOT NULL DEFAULT false
        `);
    this.addSql(`
            ALTER TABLE "runtime_instances"
            ALTER COLUMN "config"
            SET NOT NULL
        `);
    this.addSql(`
            CREATE INDEX "IDX_runtime_instances_temporary" ON "runtime_instances" ("temporary")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_runtime_instances_temporary"
        `);
    this.addSql(`
            ALTER TABLE "runtime_instances"
            ALTER COLUMN "config" DROP NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "runtime_instances" DROP COLUMN "temporary"
        `);
    this.addSql(`
            ALTER TABLE "runtime_instances"
            ADD "version" character varying(50) NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "runtime_instances"
            ADD "metadata" jsonb
        `);
  }
}
