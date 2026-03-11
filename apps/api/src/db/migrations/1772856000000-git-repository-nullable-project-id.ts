import { MigrationInterface, QueryRunner } from 'typeorm';

export class GitRepositoryNullableProjectId1772856000000 implements MigrationInterface {
  name = 'GitRepositoryNullableProjectId1772856000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the old 5-column unique index (owner, repo, createdBy, provider, projectId)
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_7a6e2621da6a14e07005c9ce95"`,
    );

    // 2. Make projectId nullable
    await queryRunner.query(
      `ALTER TABLE "git_repositories" ALTER COLUMN "projectId" DROP NOT NULL`,
    );

    // 3. Create the new 4-column unique index (owner, repo, createdBy, provider)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_git_repositories_owner_repo_createdby_provider" ON "git_repositories" ("owner", "repo", "createdBy", "provider")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the new 4-column unique index
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_git_repositories_owner_repo_createdby_provider"`,
    );

    // 2. Set projectId back to NOT NULL (set any NULLs to a placeholder first)
    await queryRunner.query(
      `UPDATE "git_repositories" SET "projectId" = '00000000-0000-0000-0000-000000000000' WHERE "projectId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "git_repositories" ALTER COLUMN "projectId" SET NOT NULL`,
    );

    // 3. Re-create the old 5-column unique index
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7a6e2621da6a14e07005c9ce95" ON "git_repositories" ("owner", "repo", "createdBy", "provider", "projectId")`,
    );
  }
}
