import { Migration } from '@mikro-orm/migrations';

export class MakeRuntimeInstanceGraphIdNullable1772732040404 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_edbcf394ee253b1671a282b5ec"
        `);
    this.addSql(`
            ALTER TABLE "runtime_instances"
            ALTER COLUMN "graphId" DROP NOT NULL
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_edbcf394ee253b1671a282b5ec" ON "runtime_instances" ("graphId", "nodeId", "threadId") NULLS NOT DISTINCT
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_edbcf394ee253b1671a282b5ec"
        `);
    this.addSql(`
            ALTER TABLE "runtime_instances"
            ALTER COLUMN "graphId"
            SET NOT NULL
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_edbcf394ee253b1671a282b5ec" ON "runtime_instances" ("graphId", "nodeId", "threadId")
        `);
  }
}
