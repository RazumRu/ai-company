import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTokenUsageToThreads1765913470902 implements MigrationInterface {
  name = 'AddTokenUsageToThreads1765913470902';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD "tokenUsage" jsonb
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "threads" DROP COLUMN "tokenUsage"
        `);
  }
}
