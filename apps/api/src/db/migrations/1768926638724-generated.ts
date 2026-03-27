import { Migration } from '@mikro-orm/migrations';

export class Generated1768926638724 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            CREATE EXTENSION IF NOT EXISTS vector
        `);
    this.addSql(`
            ALTER TABLE "knowledge_chunks" DROP COLUMN "embedding"
        `);
    this.addSql(`
            ALTER TABLE "knowledge_chunks"
            ADD "embedding" vector
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "knowledge_chunks" DROP COLUMN "embedding"
        `);
    this.addSql(`
            ALTER TABLE "knowledge_chunks"
            ADD "embedding" jsonb
        `);
  }
}
