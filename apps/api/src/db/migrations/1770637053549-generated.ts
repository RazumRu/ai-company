import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1770637053549 implements MigrationInterface {
  name = 'Generated1770637053549';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backfill any NULLs before adding NOT NULL constraint
    await queryRunner.query(`
            UPDATE "repo_indexes" SET "estimatedTokens" = 0 WHERE "estimatedTokens" IS NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "estimatedTokens"
            SET NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "estimatedTokens"
            SET DEFAULT 0
        `);
    // Backfill any NULLs before adding NOT NULL constraint
    await queryRunner.query(`
            UPDATE "repo_indexes" SET "indexedTokens" = 0 WHERE "indexedTokens" IS NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "indexedTokens"
            SET NOT NULL
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "indexedTokens" DROP NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "estimatedTokens" DROP DEFAULT
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "estimatedTokens" DROP NOT NULL
        `);
  }
}
