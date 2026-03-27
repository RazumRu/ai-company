import { Migration } from '@mikro-orm/migrations';

export class Generated1762461785810 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            CREATE TYPE "public"."graph_revisions_status_enum" AS ENUM('pending', 'applying', 'applied', 'failed')
        `);
    this.addSql(`
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
    this.addSql(`
            CREATE INDEX "IDX_c16df53f74a9053299af7a1740" ON "graph_revisions" ("graphId")
        `);
    this.addSql(`
            CREATE INDEX "IDX_9c3be1885dfe18d1c59675de45" ON "graph_revisions" ("status")
        `);
    this.addSql(`
            CREATE INDEX "IDX_8656c524a47fa65047677f6825" ON "graph_revisions" ("createdBy")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_8656c524a47fa65047677f6825"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_9c3be1885dfe18d1c59675de45"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_c16df53f74a9053299af7a1740"
        `);
    this.addSql(`
            DROP TABLE "graph_revisions"
        `);
    this.addSql(`
            DROP TYPE "public"."graph_revisions_status_enum"
        `);
  }
}
