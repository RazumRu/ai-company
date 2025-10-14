import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1760469127376 implements MigrationInterface {
  name = 'Generated1760469127376';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "graphs"
            ADD "temporary" boolean NOT NULL DEFAULT false
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "graphs" DROP COLUMN "temporary"
        `);
  }
}
