import { Migration } from '@mikro-orm/migrations';

export class Generated1772179609633 extends Migration {
  override async up(): Promise<void> {
    // Change createdBy from uuid to varchar using safe ALTER COLUMN TYPE
    // The USING cast preserves existing data by converting uuid to text

    this.addSql(`
            ALTER TABLE "threads"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);
    this.addSql(`
            ALTER TABLE "projects"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);
    this.addSql(`
            ALTER TABLE "knowledge_docs"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);
    this.addSql(`
            ALTER TABLE "graphs"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);

    // git_repositories has a unique composite index including createdBy — must drop + recreate
    this.addSql(`
            DROP INDEX "public"."IDX_7a6e2621da6a14e07005c9ce95"
        `);
    this.addSql(`
            ALTER TABLE "git_repositories"
            ALTER COLUMN "createdBy" TYPE character varying USING "createdBy"::character varying
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_7a6e2621da6a14e07005c9ce95" ON "git_repositories" (
                "owner",
                "repo",
                "createdBy",
                "provider",
                "projectId"
            )
        `);
  }

  override async down(): Promise<void> {
    // Revert createdBy from varchar back to uuid
    // The USING cast converts text back to uuid (only works if values are valid UUIDs)

    this.addSql(`
            ALTER TABLE "threads"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);
    this.addSql(`
            ALTER TABLE "projects"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);
    this.addSql(`
            ALTER TABLE "knowledge_docs"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);
    this.addSql(`
            ALTER TABLE "graphs"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);

    this.addSql(`
            DROP INDEX "public"."IDX_7a6e2621da6a14e07005c9ce95"
        `);
    this.addSql(`
            ALTER TABLE "git_repositories"
            ALTER COLUMN "createdBy" TYPE uuid USING "createdBy"::uuid
        `);
    this.addSql(`
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
