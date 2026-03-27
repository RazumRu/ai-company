import { Migration } from '@mikro-orm/migrations';

export class Generated1770623800249 extends Migration {
  override async up(): Promise<void> {
    // Add defaultBranch to git_repositories with a default value
    this.addSql(`
            ALTER TABLE "git_repositories"
            ADD "defaultBranch" character varying NOT NULL DEFAULT 'main'
        `);
    // Add branch column as nullable first, backfill using repository's defaultBranch, then make NOT NULL
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ADD "branch" character varying
        `);
    this.addSql(`
            UPDATE "repo_indexes" ri
            SET "branch" = COALESCE(gr."defaultBranch", 'main')
            FROM "git_repositories" gr
            WHERE ri."repositoryId" = gr."id" AND ri."branch" IS NULL
        `);
    // Catch any orphaned rows not matching a git_repositories record
    this.addSql(`
            UPDATE "repo_indexes" SET "branch" = 'main' WHERE "branch" IS NULL
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "branch" SET NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes" DROP CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b"
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes" DROP CONSTRAINT "UQ_001a3ccf8144b1061e35a7a7b5b"
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_3e1b2818aefe61b9141a48eb6e" ON "repo_indexes" ("repositoryId", "branch")
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ADD CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b" FOREIGN KEY ("repositoryId") REFERENCES "git_repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "repo_indexes" DROP CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_3e1b2818aefe61b9141a48eb6e"
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ADD CONSTRAINT "UQ_001a3ccf8144b1061e35a7a7b5b" UNIQUE ("repositoryId")
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ADD CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b" FOREIGN KEY ("repositoryId") REFERENCES "git_repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    this.addSql(`
            ALTER TABLE "repo_indexes" DROP COLUMN "branch"
        `);
    this.addSql(`
            ALTER TABLE "git_repositories" DROP COLUMN "defaultBranch"
        `);
  }
}
