import { Migration } from '@mikro-orm/migrations';

export class Generated1765733379573 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads"
            ADD "tokenUsage" jsonb
        `);
    this.addSql(`
            ALTER TABLE "messages"
            ADD "tokenUsage" jsonb
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "messages" DROP COLUMN "tokenUsage"
        `);
    this.addSql(`
            ALTER TABLE "threads" DROP COLUMN "tokenUsage"
        `);
  }
}
