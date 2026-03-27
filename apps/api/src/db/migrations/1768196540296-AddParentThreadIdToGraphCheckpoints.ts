import { Migration } from '@mikro-orm/migrations';

export class AddParentThreadIdToGraphCheckpoints1768196540296 extends Migration {
  override async up(): Promise<void> {
    // Add parentThreadId column to graph_checkpoints table
    this.addSql(`
            ALTER TABLE "graph_checkpoints"
            ADD COLUMN "parentThreadId" VARCHAR
        `);

    // Create index on parentThreadId for efficient lookups
    this.addSql(`
            CREATE INDEX "IDX_graph_checkpoints_parentThreadId"
            ON "graph_checkpoints" ("parentThreadId")
        `);
  }

  override async down(): Promise<void> {
    // Drop index first
    this.addSql(`
            DROP INDEX "IDX_graph_checkpoints_parentThreadId"
        `);

    // Drop column
    this.addSql(`
            ALTER TABLE "graph_checkpoints"
            DROP COLUMN "parentThreadId"
        `);
  }
}
