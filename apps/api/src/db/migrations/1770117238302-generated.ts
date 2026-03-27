import { Migration } from '@mikro-orm/migrations';

export class Generated1770117238302 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            CREATE TYPE "public"."git_repositories_provider_enum" AS ENUM('GITHUB')
        `);
    this.addSql(`
            CREATE TABLE "git_repositories" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "owner" character varying NOT NULL,
                "repo" character varying NOT NULL,
                "url" character varying NOT NULL,
                "provider" "public"."git_repositories_provider_enum" NOT NULL,
                "createdBy" uuid NOT NULL,
                CONSTRAINT "PK_6da02a2f669e59fecb5366c0031" PRIMARY KEY ("id")
            )
        `);
    this.addSql(`
            CREATE INDEX "IDX_ac33bc6a5803234be00dc839bc" ON "git_repositories" ("owner")
        `);
    this.addSql(`
            CREATE INDEX "IDX_d9121f1e2ce469c0f140253b0f" ON "git_repositories" ("repo")
        `);
    this.addSql(`
            CREATE INDEX "IDX_cdd40dd1e9a0c0ea2d77ea9f48" ON "git_repositories" ("createdBy")
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_0c83196e1a740179647ff52872" ON "git_repositories" ("owner", "repo", "createdBy", "provider")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_0c83196e1a740179647ff52872"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_cdd40dd1e9a0c0ea2d77ea9f48"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_d9121f1e2ce469c0f140253b0f"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_ac33bc6a5803234be00dc839bc"
        `);
    this.addSql(`
            DROP TABLE "git_repositories"
        `);
    this.addSql(`
            DROP TYPE "public"."git_repositories_provider_enum"
        `);
  }
}
