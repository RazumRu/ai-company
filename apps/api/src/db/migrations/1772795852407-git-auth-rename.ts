import { MigrationInterface, QueryRunner } from 'typeorm';

export class GitAuthRename1772795852407 implements MigrationInterface {
  name = 'GitAuthRename1772795852407';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop old unique constraint and index BEFORE renaming/dropping columns
    await queryRunner.query(
      `ALTER TABLE "github_app_installations" DROP CONSTRAINT "UQ_9aa22cac14d9182d6226113c75b"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_b7d85e6ecba6cfd4cb1b9abed3"`,
    );

    // 2. Rename table
    await queryRunner.query(
      `ALTER TABLE "github_app_installations" RENAME TO "git_provider_connections"`,
    );

    // 3. Add provider column with default 'github'
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" ADD "provider" character varying NOT NULL DEFAULT 'github'`,
    );

    // 4. Add metadata jsonb column
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" ADD "metadata" jsonb DEFAULT '{}'`,
    );

    // 5. Populate metadata from existing columns
    await queryRunner.query(
      `UPDATE "git_provider_connections" SET "metadata" = jsonb_build_object('installationId', "installationId", 'accountType', "accountType")`,
    );

    // 6. Drop old columns (now stored in metadata)
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" DROP COLUMN "installationId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" DROP COLUMN "accountType"`,
    );

    // 7. Add new unique constraint on (userId, provider, accountLogin)
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" ADD CONSTRAINT "UQ_git_provider_connections_user_provider_login" UNIQUE ("userId", "provider", "accountLogin")`,
    );

    // 8. Add index on provider column
    await queryRunner.query(
      `CREATE INDEX "IDX_git_provider_connections_provider" ON "git_provider_connections" ("provider")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse: drop new index and constraint
    await queryRunner.query(
      `DROP INDEX "public"."IDX_git_provider_connections_provider"`,
    );
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" DROP CONSTRAINT "UQ_git_provider_connections_user_provider_login"`,
    );

    // Restore installationId and accountType columns from metadata
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" ADD "installationId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" ADD "accountType" character varying`,
    );

    // Populate from metadata
    await queryRunner.query(
      `UPDATE "git_provider_connections" SET "installationId" = ("metadata"->>'installationId')::integer, "accountType" = "metadata"->>'accountType'`,
    );

    // Make columns NOT NULL
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" ALTER COLUMN "installationId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" ALTER COLUMN "accountType" SET NOT NULL`,
    );

    // Drop provider and metadata columns
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" DROP COLUMN "metadata"`,
    );
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" DROP COLUMN "provider"`,
    );

    // Restore old unique constraint and index
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" ADD CONSTRAINT "UQ_9aa22cac14d9182d6226113c75b" UNIQUE ("userId", "installationId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b7d85e6ecba6cfd4cb1b9abed3" ON "git_provider_connections" ("installationId")`,
    );

    // Rename table back
    await queryRunner.query(
      `ALTER TABLE "git_provider_connections" RENAME TO "github_app_installations"`,
    );
  }
}
