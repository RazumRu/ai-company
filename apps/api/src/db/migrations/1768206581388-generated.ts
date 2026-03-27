import { Migration } from '@mikro-orm/migrations';

export class Generated1768206581388 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_graph_checkpoints_parentThreadId"
        `);
    this.addSql(`
            CREATE INDEX "IDX_3cab3aab51c7394a1133560768" ON "graph_checkpoints" ("parentThreadId")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_3cab3aab51c7394a1133560768"
        `);
    this.addSql(`
            ALTER TABLE "messages"
            ADD "requestUsage" jsonb
        `);
    this.addSql(`
            CREATE INDEX "IDX_graph_checkpoints_parentThreadId" ON "graph_checkpoints" ("parentThreadId")
        `);
  }
}
