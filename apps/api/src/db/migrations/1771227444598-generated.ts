import { Migration } from '@mikro-orm/migrations';

export class Generated1771227444598 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "messages"
            ADD "toolCallIds" text
        `);
    this.addSql(`
            ALTER TABLE "messages"
            ADD "additionalKwargs" jsonb
        `);
    this.addSql(`
            ALTER TABLE "messages"
            ADD "toolTokenUsage" jsonb
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "messages" DROP COLUMN "toolTokenUsage"
        `);
    this.addSql(`
            ALTER TABLE "messages" DROP COLUMN "additionalKwargs"
        `);
    this.addSql(`
            ALTER TABLE "messages" DROP COLUMN "toolCallIds"
        `);
  }
}
