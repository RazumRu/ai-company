import { Migration } from '@mikro-orm/migrations';

export class AddToolCallNamesToMessages1768209000000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "messages"
      ADD COLUMN "toolCallNames" text
    `);

    // Populate toolCallNames for existing AI messages with tool calls
    this.addSql(`
      UPDATE "messages"
      SET "toolCallNames" = (
        SELECT string_agg(tool_call->>'name', ',')
        FROM jsonb_array_elements(message->'toolCalls') AS tool_call
        WHERE tool_call->>'name' IS NOT NULL
      )
      WHERE role = 'ai'
        AND message->'toolCalls' IS NOT NULL
        AND jsonb_array_length(message->'toolCalls') > 0
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "messages"
      DROP COLUMN "toolCallNames"
    `);
  }
}
