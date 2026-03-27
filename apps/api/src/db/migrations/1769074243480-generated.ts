import { Migration } from '@mikro-orm/migrations';

export class Generated1769074243480 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "knowledge_docs"
            ADD "politic" text
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "knowledge_docs" DROP COLUMN "politic"
        `);
  }
}
