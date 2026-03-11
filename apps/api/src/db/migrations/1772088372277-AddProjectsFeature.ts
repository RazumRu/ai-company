import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectsFeature1772088372277 implements MigrationInterface {
  name = 'AddProjectsFeature1772088372277';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX IF EXISTS "public"."IDX_0c83196e1a740179647ff52872"
        `);
    await queryRunner.query(`
            CREATE TABLE "projects" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying(255) NOT NULL,
                "description" text,
                "icon" character varying(50),
                "color" character varying(20),
                "settings" jsonb NOT NULL DEFAULT '{}',
                "createdBy" uuid NOT NULL,
                CONSTRAINT "PK_6271df0a7aed1d6c0691ce6ac50" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_4fcfae511b4f6aaa67a8d32596" ON "projects" ("createdBy")
        `);
    await queryRunner.query(`
            ALTER TABLE "knowledge_docs"
            ADD "projectId" uuid
        `);
    await queryRunner.query(`
            ALTER TABLE "graphs"
            ADD "projectId" uuid
        `);
    await queryRunner.query(`
            ALTER TABLE "git_repositories"
            ADD "projectId" uuid
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_e847cd5e64a00441fb254b4248" ON "knowledge_docs" ("projectId")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_16c67c5ed33f8ad80686455df5" ON "graphs" ("projectId")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_21cc46a19a72cc0fb71d443676" ON "git_repositories" ("projectId")
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

    // Create Default Project per user for existing data (include all rows, even soft-deleted,
    // so the subsequent NOT NULL constraint is satisfiable for every row)
    await queryRunner.query(`
            INSERT INTO "projects" ("id", "name", "description", "icon", "color", "settings", "createdBy", "createdAt", "updatedAt")
            SELECT
                gen_random_uuid(),
                'Default',
                NULL, NULL, NULL,
                '{}',
                sub,
                NOW(),
                NOW()
            FROM (
                SELECT DISTINCT "createdBy" AS sub FROM "graphs"
                UNION
                SELECT DISTINCT "createdBy" AS sub FROM "knowledge_docs"
                UNION
                SELECT DISTINCT "createdBy" AS sub FROM "git_repositories"
            ) AS users
        `);

    // Back-fill projectId for graphs
    await queryRunner.query(`
            UPDATE "graphs" g
            SET "projectId" = p."id"
            FROM "projects" p
            WHERE p."createdBy" = g."createdBy"
                AND p."deletedAt" IS NULL
                AND g."projectId" IS NULL
        `);

    // Back-fill projectId for knowledge_docs
    await queryRunner.query(`
            UPDATE "knowledge_docs" kd
            SET "projectId" = p."id"
            FROM "projects" p
            WHERE p."createdBy" = kd."createdBy"
                AND p."deletedAt" IS NULL
                AND kd."projectId" IS NULL
        `);

    // Back-fill projectId for git_repositories
    await queryRunner.query(`
            UPDATE "git_repositories" gr
            SET "projectId" = p."id"
            FROM "projects" p
            WHERE p."createdBy" = gr."createdBy"
                AND p."deletedAt" IS NULL
                AND gr."projectId" IS NULL
        `);

    // Set NOT NULL after back-fill
    await queryRunner.query(
      `ALTER TABLE "graphs" ALTER COLUMN "projectId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_docs" ALTER COLUMN "projectId" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "git_repositories" ALTER COLUMN "projectId" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "graphs" ALTER COLUMN "projectId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_docs" ALTER COLUMN "projectId" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "git_repositories" ALTER COLUMN "projectId" DROP NOT NULL`,
    );
    await queryRunner.query(`DELETE FROM "projects" WHERE "name" = 'Default'`);

    await queryRunner.query(`
            DROP INDEX "public"."IDX_7a6e2621da6a14e07005c9ce95"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_21cc46a19a72cc0fb71d443676"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_16c67c5ed33f8ad80686455df5"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_e847cd5e64a00441fb254b4248"
        `);
    await queryRunner.query(`
            ALTER TABLE "git_repositories" DROP COLUMN "projectId"
        `);
    await queryRunner.query(`
            ALTER TABLE "graphs" DROP COLUMN "projectId"
        `);
    await queryRunner.query(`
            ALTER TABLE "knowledge_docs" DROP COLUMN "projectId"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_4fcfae511b4f6aaa67a8d32596"
        `);
    await queryRunner.query(`
            DROP TABLE "projects"
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_0c83196e1a740179647ff52872" ON "git_repositories" ("createdBy", "owner", "provider", "repo")
        `);
  }
}
