import { Migration } from '@mikro-orm/migrations';

export class AddTokenUsageToThreads1765913470902 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads"
            ADD "tokenUsage" jsonb
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads" DROP COLUMN "tokenUsage"
        `);
  }
}
