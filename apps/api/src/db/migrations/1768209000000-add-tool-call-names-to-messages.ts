import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddToolCallNamesToMessages1768209000000 implements MigrationInterface {
  name = 'AddToolCallNamesToMessages1768209000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "messages"
      ADD COLUMN "toolCallNames" text
    `);

    // Populate toolCallNames for existing AI messages with tool calls
    await queryRunner.query(`
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

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "messages"
      DROP COLUMN "toolCallNames"
    `);
  }
}
