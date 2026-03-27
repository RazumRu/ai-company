import { Migration } from '@mikro-orm/migrations';

export class Generated1765639738210 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads"
            ADD "lastRunId" uuid
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads" DROP COLUMN "lastRunId"
        `);
  }
}
