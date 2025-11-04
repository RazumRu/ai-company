import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1762201441417 implements MigrationInterface {
  name = 'Generated1762201441417';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD "status" character varying NOT NULL DEFAULT 'running'
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_c69829dccdf02bb79717b83271" ON "threads" ("status")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_c69829dccdf02bb79717b83271"
        `);
    await queryRunner.query(`
            ALTER TABLE "threads" DROP COLUMN "status"
        `);
  }
}
