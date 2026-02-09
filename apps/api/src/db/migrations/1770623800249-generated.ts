import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1770623800249 implements MigrationInterface {
  name = 'Generated1770623800249';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add defaultBranch to git_repositories with a default value
    await queryRunner.query(`
            ALTER TABLE "git_repositories"
            ADD "defaultBranch" character varying NOT NULL DEFAULT 'main'
        `);
    // Add branch column as nullable first, backfill using repository's defaultBranch, then make NOT NULL
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ADD "branch" character varying
        `);
    await queryRunner.query(`
            UPDATE "repo_indexes" ri
            SET "branch" = COALESCE(gr."defaultBranch", 'main')
            FROM "git_repositories" gr
            WHERE ri."repositoryId" = gr."id" AND ri."branch" IS NULL
        `);
    // Catch any orphaned rows not matching a git_repositories record
    await queryRunner.query(`
            UPDATE "repo_indexes" SET "branch" = 'main' WHERE "branch" IS NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ALTER COLUMN "branch" SET NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes" DROP CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b"
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes" DROP CONSTRAINT "UQ_001a3ccf8144b1061e35a7a7b5b"
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_3e1b2818aefe61b9141a48eb6e" ON "repo_indexes" ("repositoryId", "branch")
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ADD CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b" FOREIGN KEY ("repositoryId") REFERENCES "git_repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "repo_indexes" DROP CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_3e1b2818aefe61b9141a48eb6e"
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ADD CONSTRAINT "UQ_001a3ccf8144b1061e35a7a7b5b" UNIQUE ("repositoryId")
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ADD CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b" FOREIGN KEY ("repositoryId") REFERENCES "git_repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "repo_indexes" DROP COLUMN "branch"
        `);
    await queryRunner.query(`
            ALTER TABLE "git_repositories" DROP COLUMN "defaultBranch"
        `);
  }
}
