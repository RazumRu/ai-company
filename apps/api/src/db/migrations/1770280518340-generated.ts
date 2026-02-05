import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1770280518340 implements MigrationInterface {
  name = 'Generated1770280518340';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ADD "indexedTokens" integer DEFAULT '0'
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "repo_indexes" DROP COLUMN "indexedTokens"
        `);
  }
}
