import { Migration } from '@mikro-orm/migrations';

export class MigrateRequestUsageToTokenUsage1768196540297 extends Migration {
  override async up(): Promise<void> {
    // Migrate existing data: extract __requestUsage from message.additionalKwargs
    // and populate the tokenUsage column (overwriting minimal data with full TokenUsage)
    this.addSql(`
            UPDATE "messages"
            SET "tokenUsage" = (
                message -> 'additionalKwargs' -> '__requestUsage'
            )::jsonb
            WHERE message -> 'additionalKwargs' ? '__requestUsage'
            AND (message -> 'additionalKwargs' -> '__requestUsage') IS NOT NULL
        `);
  }

  override async down(): Promise<void> {
    // No-op: We don't want to lose the full token usage data
    // The old minimal data structure is a subset, so no rollback needed
  }
}
