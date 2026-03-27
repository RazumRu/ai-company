import { Migration } from '@mikro-orm/migrations';

export class GitRepositoryNullableProjectId1772856000000 extends Migration {
  override async up(): Promise<void> {
    // 1. Drop the old 5-column unique index (owner, repo, createdBy, provider, projectId)
    this.addSql(
      `DROP INDEX IF EXISTS "public"."IDX_7a6e2621da6a14e07005c9ce95"`,
    );

    // 2. Make projectId nullable
    this.addSql(
      `ALTER TABLE "git_repositories" ALTER COLUMN "projectId" DROP NOT NULL`,
    );

    // 3. Create the new 4-column unique index (owner, repo, createdBy, provider)
    this.addSql(
      `CREATE UNIQUE INDEX "IDX_git_repositories_owner_repo_createdby_provider" ON "git_repositories" ("owner", "repo", "createdBy", "provider")`,
    );
  }

  override async down(): Promise<void> {
    // 1. Drop the new 4-column unique index
    this.addSql(
      `DROP INDEX IF EXISTS "public"."IDX_git_repositories_owner_repo_createdby_provider"`,
    );

    // 2. Set projectId back to NOT NULL (set any NULLs to a placeholder first)
    this.addSql(
      `UPDATE "git_repositories" SET "projectId" = '00000000-0000-0000-0000-000000000000' WHERE "projectId" IS NULL`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" ALTER COLUMN "projectId" SET NOT NULL`,
    );

    // 3. Re-create the old 5-column unique index
    this.addSql(
      `CREATE UNIQUE INDEX "IDX_7a6e2621da6a14e07005c9ce95" ON "git_repositories" ("owner", "repo", "createdBy", "provider", "projectId")`,
    );
  }
}
