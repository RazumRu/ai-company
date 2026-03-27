import { Migration } from '@mikro-orm/migrations';

export class Generated1760469127376 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "graphs"
            ADD "temporary" boolean NOT NULL DEFAULT false
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "graphs" DROP COLUMN "temporary"
        `);
  }
}
