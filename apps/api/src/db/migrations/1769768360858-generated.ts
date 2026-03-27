import { Migration } from '@mikro-orm/migrations';

export class Generated1769768360858 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "knowledge_docs"
            ADD "embeddingModel" text
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "knowledge_docs" DROP COLUMN "embeddingModel"
        `);
  }
}
