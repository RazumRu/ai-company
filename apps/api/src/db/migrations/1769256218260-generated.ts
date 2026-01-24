import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1769256218260 implements MigrationInterface {
  name = 'Generated1769256218260';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "knowledge_docs"
            ADD "publicId" SERIAL NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "knowledge_chunks"
            ADD "publicId" SERIAL NOT NULL
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_df44a1b6f684c23d7a325dcafd" ON "knowledge_docs" ("publicId")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_1057f9147e2cc20ceec7af0bb5" ON "knowledge_chunks" ("publicId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_1057f9147e2cc20ceec7af0bb5"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_df44a1b6f684c23d7a325dcafd"
        `);
    await queryRunner.query(`
            ALTER TABLE "knowledge_chunks" DROP COLUMN "publicId"
        `);
    await queryRunner.query(`
            ALTER TABLE "knowledge_docs" DROP COLUMN "publicId"
        `);
  }
}
