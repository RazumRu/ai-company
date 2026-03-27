import { Migration } from '@mikro-orm/migrations';

export class RemoveTokenUsageFromThreads1768197069213 extends Migration {
  override async up(): Promise<void> {
    // Remove tokenUsage column from threads table
    // Token usage is now stored in checkpoint state only
    this.addSql(`
            ALTER TABLE "threads"
            DROP COLUMN "tokenUsage"
        `);
  }

  override async down(): Promise<void> {
    // Re-add tokenUsage column
    this.addSql(`
            ALTER TABLE "threads"
            ADD "tokenUsage" jsonb
        `);
  }
}
