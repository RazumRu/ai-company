import { Migration } from '@mikro-orm/migrations';

export class Generated1770374821534 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            CREATE INDEX "IDX_1de5896f100d9e9b87875424ac" ON "repo_indexes" ("status")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_1de5896f100d9e9b87875424ac"
        `);
  }
}
