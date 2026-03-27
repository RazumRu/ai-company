import { Migration } from '@mikro-orm/migrations';

export class AddNameToThreads1761773225903 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads"
            ADD "name" character varying
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads" DROP COLUMN "name"
        `);
  }
}
