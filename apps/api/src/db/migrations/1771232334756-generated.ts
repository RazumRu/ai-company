import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1771232334756 implements MigrationInterface {
  name = 'Generated1771232334756';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Convert simple-array (comma-separated text) to native PostgreSQL text[] arrays.
    // USING clause converts existing comma-separated values to proper arrays.
    await queryRunner.query(`
      ALTER TABLE "messages"
        ALTER COLUMN "toolCallNames" TYPE text[]
          USING CASE
            WHEN "toolCallNames" IS NULL THEN NULL
            WHEN "toolCallNames" = '' THEN '{}'::text[]
            ELSE string_to_array("toolCallNames", ',')
          END
    `);
    await queryRunner.query(`
      ALTER TABLE "messages"
        ALTER COLUMN "answeredToolCallNames" TYPE text[]
          USING CASE
            WHEN "answeredToolCallNames" IS NULL THEN NULL
            WHEN "answeredToolCallNames" = '' THEN '{}'::text[]
            ELSE string_to_array("answeredToolCallNames", ',')
          END
    `);
    await queryRunner.query(`
      ALTER TABLE "messages"
        ALTER COLUMN "toolCallIds" TYPE text[]
          USING CASE
            WHEN "toolCallIds" IS NULL THEN NULL
            WHEN "toolCallIds" = '' THEN '{}'::text[]
            ELSE string_to_array("toolCallIds", ',')
          END
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert text[] arrays back to comma-separated text (simple-array format)
    await queryRunner.query(`
      ALTER TABLE "messages"
        ALTER COLUMN "toolCallIds" TYPE text
          USING array_to_string("toolCallIds", ',')
    `);
    await queryRunner.query(`
      ALTER TABLE "messages"
        ALTER COLUMN "answeredToolCallNames" TYPE text
          USING array_to_string("answeredToolCallNames", ',')
    `);
    await queryRunner.query(`
      ALTER TABLE "messages"
        ALTER COLUMN "toolCallNames" TYPE text
          USING array_to_string("toolCallNames", ',')
    `);
  }
}
