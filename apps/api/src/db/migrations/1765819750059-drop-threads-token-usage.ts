import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropThreadsTokenUsage1765819750059 implements MigrationInterface {
  name = 'DropThreadsTokenUsage1765819750059';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "threads" DROP COLUMN "tokenUsage"
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD "tokenUsage" jsonb
        `);
  }
}
