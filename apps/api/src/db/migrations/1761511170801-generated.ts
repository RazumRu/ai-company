import { Migration } from '@mikro-orm/migrations';

export class Generated1761511170801 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_2aecc6fa23e93aacd536433927"
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_2aecc6fa23e93aacd536433927" ON "threads" ("externalThreadId")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_2aecc6fa23e93aacd536433927"
        `);
    this.addSql(`
            CREATE INDEX "IDX_2aecc6fa23e93aacd536433927" ON "threads" ("externalThreadId")
        `);
  }
}
