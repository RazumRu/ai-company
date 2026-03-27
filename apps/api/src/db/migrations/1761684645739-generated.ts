import { Migration } from '@mikro-orm/migrations';

export class Generated1761684645739 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads"
            ADD "source" character varying
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads" DROP COLUMN "source"
        `);
  }
}
