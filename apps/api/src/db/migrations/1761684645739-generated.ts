import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1761684645739 implements MigrationInterface {
  name = 'Generated1761684645739';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD "source" character varying
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "threads" DROP COLUMN "source"
        `);
  }
}
