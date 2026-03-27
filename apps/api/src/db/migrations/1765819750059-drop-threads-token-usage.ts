import { Migration } from '@mikro-orm/migrations';

export class DropThreadsTokenUsage1765819750059 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads" DROP COLUMN "tokenUsage"
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads"
            ADD "tokenUsage" jsonb
        `);
  }
}
