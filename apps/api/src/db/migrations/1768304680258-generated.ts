import { Migration } from '@mikro-orm/migrations';

export class Generated1768304680258 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "messages"
            ADD "answeredToolCallNames" text
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "messages" DROP COLUMN "answeredToolCallNames"
        `);
  }
}
