import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateRequestUsageToTokenUsage1768196540297 implements MigrationInterface {
  name = 'MigrateRequestUsageToTokenUsage1768196540297';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Migrate existing data: extract __requestUsage from message.additionalKwargs
    // and populate the tokenUsage column (overwriting minimal data with full TokenUsage)
    await queryRunner.query(`
            UPDATE "messages"
            SET "tokenUsage" = (
                message -> 'additionalKwargs' -> '__requestUsage'
            )::jsonb
            WHERE message -> 'additionalKwargs' ? '__requestUsage'
            AND (message -> 'additionalKwargs' -> '__requestUsage') IS NOT NULL
        `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: We don't want to lose the full token usage data
    // The old minimal data structure is a subset, so no rollback needed
  }
}
