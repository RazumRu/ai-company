import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNameToThreads1761773225903 implements MigrationInterface {
  name = 'AddNameToThreads1761773225903';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD "name" character varying
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "threads" DROP COLUMN "name"
        `);
  }
}
