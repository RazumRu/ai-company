import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1772179609633 implements MigrationInterface {
  name = 'Generated1772179609633';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Change createdBy from uuid to varchar using safe ALTER COLUMN TYPE
    // The USING cast preserves existing data by converting uuid to text

    await queryRunner.query(`
            ALTER TABLE "threads"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);
    await queryRunner.query(`
            ALTER TABLE "projects"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);
    await queryRunner.query(`
            ALTER TABLE "knowledge_docs"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);
    await queryRunner.query(`
            ALTER TABLE "graphs"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);

    // git_repositories has a unique composite index including createdBy — must drop + recreate
    await queryRunner.query(`
            DROP INDEX "public"."IDX_7a6e2621da6a14e07005c9ce95"
        `);
    await queryRunner.query(`
            ALTER TABLE "git_repositories"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_7a6e2621da6a14e07005c9ce95" ON "git_repositories" (
                "owner",
                "repo",
                "createdBy",
                "provider",
                "projectId"
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert createdBy from varchar back to uuid
    // The USING cast converts text back to uuid (only works if values are valid UUIDs)

    await queryRunner.query(`
            ALTER TABLE "threads"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);
    await queryRunner.query(`
            ALTER TABLE "projects"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);
    await queryRunner.query(`
            ALTER TABLE "knowledge_docs"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);
    await queryRunner.query(`
            ALTER TABLE "graphs"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);

    await queryRunner.query(`
            DROP INDEX "public"."IDX_7a6e2621da6a14e07005c9ce95"
        `);
    await queryRunner.query(`
            ALTER TABLE "git_repositories"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_7a6e2621da6a14e07005c9ce95" ON "git_repositories" (
                "owner",
                "repo",
                "createdBy",
                "provider",
                "projectId"
            )
        `);
  }
}
