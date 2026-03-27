import { Migration } from '@mikro-orm/migrations';

export class Generated1774335741918 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "webhook_sync_state"
                RENAME COLUMN "last_sync_date" TO "lastSyncDate"
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "webhook_sync_state"
                RENAME COLUMN "lastSyncDate" TO "last_sync_date"
        `);
  }
}
