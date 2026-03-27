import { Migration } from '@mikro-orm/migrations';

export class AddNodeIdToGraphCheckpoints1768304680259 extends Migration {
  override async up(): Promise<void> {
    // Add nodeId column to graph_checkpoints table
    this.addSql(`
            ALTER TABLE "graph_checkpoints"
            ADD COLUMN "nodeId" VARCHAR
        `);

    // Create index on nodeId for efficient lookups
    this.addSql(`
            CREATE INDEX "IDX_graph_checkpoints_nodeId"
            ON "graph_checkpoints" ("nodeId")
        `);
  }

  override async down(): Promise<void> {
    // Drop index first
    this.addSql(`
            DROP INDEX "IDX_graph_checkpoints_nodeId"
        `);

    // Drop column
    this.addSql(`
            ALTER TABLE "graph_checkpoints"
            DROP COLUMN "nodeId"
        `);
  }
}
