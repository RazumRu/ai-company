import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1762461785810 implements MigrationInterface {
  name = 'Generated1762461785810';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."graph_revisions_status_enum" AS ENUM('pending', 'applying', 'applied', 'failed')
        `);
    await queryRunner.query(`
            CREATE TABLE "graph_revisions" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "graphId" uuid NOT NULL,
                "fromVersion" character varying(50) NOT NULL,
                "toVersion" character varying(50) NOT NULL,
                "configurationDiff" jsonb NOT NULL,
                "newSchema" jsonb NOT NULL,
                "status" "public"."graph_revisions_status_enum" NOT NULL DEFAULT 'pending',
                "error" text,
                "createdBy" uuid NOT NULL,
                CONSTRAINT "PK_0a0462eb89ae062d8bd3345872a" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_c16df53f74a9053299af7a1740" ON "graph_revisions" ("graphId")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_9c3be1885dfe18d1c59675de45" ON "graph_revisions" ("status")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_8656c524a47fa65047677f6825" ON "graph_revisions" ("createdBy")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_8656c524a47fa65047677f6825"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_9c3be1885dfe18d1c59675de45"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_c16df53f74a9053299af7a1740"
        `);
    await queryRunner.query(`
            DROP TABLE "graph_revisions"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."graph_revisions_status_enum"
        `);
  }
}
