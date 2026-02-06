import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1770374821534 implements MigrationInterface {
  name = 'Generated1770374821534';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE INDEX "IDX_1de5896f100d9e9b87875424ac" ON "repo_indexes" ("status")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_1de5896f100d9e9b87875424ac"
        `);
  }
}
