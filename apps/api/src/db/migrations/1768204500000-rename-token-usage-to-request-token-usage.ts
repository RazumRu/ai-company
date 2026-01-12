import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameTokenUsageToRequestTokenUsage1768204500000 implements MigrationInterface {
  name = 'RenameTokenUsageToRequestTokenUsage1768204500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename tokenUsage column to requestTokenUsage in messages table
    await queryRunner.query(`
      ALTER TABLE "messages"
      RENAME COLUMN "tokenUsage" TO "requestTokenUsage"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rename requestTokenUsage column back to tokenUsage
    await queryRunner.query(`
      ALTER TABLE "messages"
      RENAME COLUMN "requestTokenUsage" TO "tokenUsage"
    `);
  }
}
