import { Migration } from '@mikro-orm/migrations';

export class Generated1770637053549 extends Migration {
  override async up(): Promise<void> {
    // Backfill any NULLs before adding NOT NULL constraint
    this.addSql(`
            UPDATE "repo_indexes" SET "estimatedTokens" = 0 WHERE "estimatedTokens" IS NULL
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "estimatedTokens"
            SET NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "estimatedTokens"
            SET DEFAULT 0
        `);
    // Backfill any NULLs before adding NOT NULL constraint
    this.addSql(`
            UPDATE "repo_indexes" SET "indexedTokens" = 0 WHERE "indexedTokens" IS NULL
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "indexedTokens"
            SET NOT NULL
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "indexedTokens" DROP NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "estimatedTokens" DROP DEFAULT
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "estimatedTokens" DROP NOT NULL
        `);
  }
}
