import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1769768360858 implements MigrationInterface {
  name = 'Generated1769768360858';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "knowledge_docs"
            ADD "embeddingModel" text
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "knowledge_docs" DROP COLUMN "embeddingModel"
        `);
  }
}
