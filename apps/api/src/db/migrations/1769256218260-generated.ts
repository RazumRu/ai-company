import { Migration } from '@mikro-orm/migrations';

export class Generated1769256218260 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "knowledge_docs"
            ADD "publicId" SERIAL NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "knowledge_chunks"
            ADD "publicId" SERIAL NOT NULL
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_df44a1b6f684c23d7a325dcafd" ON "knowledge_docs" ("publicId")
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_1057f9147e2cc20ceec7af0bb5" ON "knowledge_chunks" ("publicId")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_1057f9147e2cc20ceec7af0bb5"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_df44a1b6f684c23d7a325dcafd"
        `);
    this.addSql(`
            ALTER TABLE "knowledge_chunks" DROP COLUMN "publicId"
        `);
    this.addSql(`
            ALTER TABLE "knowledge_docs" DROP COLUMN "publicId"
        `);
  }
}
