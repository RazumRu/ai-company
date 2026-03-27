import { Migration } from '@mikro-orm/migrations';

export class Generated1772184988783 extends Migration {
  override async up(): Promise<void> {
    // Add projectId as nullable first so existing rows don't violate NOT NULL
    this.addSql(`
            ALTER TABLE "threads"
            ADD "projectId" uuid
        `);

    // Populate projectId for existing threads from their associated graph
    this.addSql(`
            UPDATE "threads"
            SET "projectId" = "graphs"."projectId"
            FROM "graphs"
            WHERE "threads"."graphId" = "graphs"."id"
        `);

    // Now set NOT NULL after all rows are populated
    this.addSql(`
            ALTER TABLE "threads"
            ALTER COLUMN "projectId" SET NOT NULL
        `);

    this.addSql(`
            CREATE INDEX "IDX_3acbab3c91ef7c75eb0709f44f" ON "threads" ("projectId")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_3acbab3c91ef7c75eb0709f44f"
        `);
    this.addSql(`
            ALTER TABLE "threads" DROP COLUMN "projectId"
        `);
  }
}
