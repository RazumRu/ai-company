import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1769074243480 implements MigrationInterface {
  name = 'Generated1769074243480';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "knowledge_docs"
            ADD "politic" text
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "knowledge_docs" DROP COLUMN "politic"
        `);
  }
}
