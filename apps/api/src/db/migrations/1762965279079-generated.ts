import { Migration } from '@mikro-orm/migrations';

export class Generated1762965279079 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            CREATE INDEX "IDX_31c0acef25b5e1204c253aaad1" ON "graph_revisions" ("graphId", "toVersion")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_31c0acef25b5e1204c253aaad1"
        `);
  }
}
