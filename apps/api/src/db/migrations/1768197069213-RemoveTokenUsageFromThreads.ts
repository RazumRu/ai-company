import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveTokenUsageFromThreads1768197069213 implements MigrationInterface {
  name = 'RemoveTokenUsageFromThreads1768197069213';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove tokenUsage column from threads table
    // Token usage is now stored in checkpoint state only
    await queryRunner.query(`
            ALTER TABLE "threads"
            DROP COLUMN "tokenUsage"
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add tokenUsage column
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD "tokenUsage" jsonb
        `);
  }
}
