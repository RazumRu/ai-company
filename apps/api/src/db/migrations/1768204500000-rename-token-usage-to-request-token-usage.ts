import { Migration } from '@mikro-orm/migrations';

export class RenameTokenUsageToRequestTokenUsage1768204500000 extends Migration {
  override async up(): Promise<void> {
    // Rename tokenUsage column to requestTokenUsage in messages table
    this.addSql(`
      ALTER TABLE "messages"
      RENAME COLUMN "tokenUsage" TO "requestTokenUsage"
    `);
  }

  override async down(): Promise<void> {
    // Rename requestTokenUsage column back to tokenUsage
    this.addSql(`
      ALTER TABLE "messages"
      RENAME COLUMN "requestTokenUsage" TO "tokenUsage"
    `);
  }
}
