import { Migration } from '@mikro-orm/migrations';

export class Generated1771232334756 extends Migration {
  override async up(): Promise<void> {
    // Convert simple-array (comma-separated text) to native PostgreSQL text[] arrays.
    // USING clause converts existing comma-separated values to proper arrays.
    this.addSql(`
      ALTER TABLE "messages"
        ALTER COLUMN "toolCallNames" TYPE text[]
          USING CASE
            WHEN "toolCallNames" IS NULL THEN NULL
            WHEN "toolCallNames" = '' THEN '{}'::text[]
            ELSE string_to_array("toolCallNames", ',')
          END
    `);
    this.addSql(`
      ALTER TABLE "messages"
        ALTER COLUMN "answeredToolCallNames" TYPE text[]
          USING CASE
            WHEN "answeredToolCallNames" IS NULL THEN NULL
            WHEN "answeredToolCallNames" = '' THEN '{}'::text[]
            ELSE string_to_array("answeredToolCallNames", ',')
          END
    `);
    this.addSql(`
      ALTER TABLE "messages"
        ALTER COLUMN "toolCallIds" TYPE text[]
          USING CASE
            WHEN "toolCallIds" IS NULL THEN NULL
            WHEN "toolCallIds" = '' THEN '{}'::text[]
            ELSE string_to_array("toolCallIds", ',')
          END
    `);
  }

  override async down(): Promise<void> {
    // Revert text[] arrays back to comma-separated text (simple-array format)
    this.addSql(`
      ALTER TABLE "messages"
        ALTER COLUMN "toolCallIds" TYPE text
          USING array_to_string("toolCallIds", ',')
    `);
    this.addSql(`
      ALTER TABLE "messages"
        ALTER COLUMN "answeredToolCallNames" TYPE text
          USING array_to_string("answeredToolCallNames", ',')
    `);
    this.addSql(`
      ALTER TABLE "messages"
        ALTER COLUMN "toolCallNames" TYPE text
          USING array_to_string("toolCallNames", ',')
    `);
  }
}
