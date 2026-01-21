import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1768926638724 implements MigrationInterface {
  name = 'Generated1768926638724';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE EXTENSION IF NOT EXISTS vector
        `);
    await queryRunner.query(`
            ALTER TABLE "knowledge_chunks" DROP COLUMN "embedding"
        `);
    await queryRunner.query(`
            ALTER TABLE "knowledge_chunks"
            ADD "embedding" vector
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "knowledge_chunks" DROP COLUMN "embedding"
        `);
    await queryRunner.query(`
            ALTER TABLE "knowledge_chunks"
            ADD "embedding" jsonb
        `);
  }
}
