import { Migration } from '@mikro-orm/migrations';

export class Generated1771688261812 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            CREATE TABLE "github_app_installations" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "userId" character varying NOT NULL,
                "installationId" integer NOT NULL,
                "accountLogin" character varying NOT NULL,
                "accountType" character varying NOT NULL,
                "isActive" boolean NOT NULL DEFAULT true,
                CONSTRAINT "UQ_9aa22cac14d9182d6226113c75b" UNIQUE ("userId", "installationId"),
                CONSTRAINT "PK_25a63d76935ddf621bfb6277954" PRIMARY KEY ("id")
            )
        `);
    this.addSql(`
            CREATE INDEX "IDX_490c838354d2f7c3848ac76bf2" ON "github_app_installations" ("userId")
        `);
    this.addSql(`
            CREATE INDEX "IDX_b7d85e6ecba6cfd4cb1b9abed3" ON "github_app_installations" ("installationId")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_b7d85e6ecba6cfd4cb1b9abed3"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_490c838354d2f7c3848ac76bf2"
        `);
    this.addSql(`
            DROP TABLE "github_app_installations"
        `);
  }
}
