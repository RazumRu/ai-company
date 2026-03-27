import { Migration } from '@mikro-orm/migrations';

export class Generated1774281863983 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            CREATE TYPE "public"."webhook_sync_state_type_enum" AS ENUM('gh_issue')
        `);
    this.addSql(`
            CREATE TABLE "webhook_sync_state" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "type" "public"."webhook_sync_state_type_enum" NOT NULL,
                "last_sync_date" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_3bd41d8a9ef8efb2231365c59fc" PRIMARY KEY ("id")
            )
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_56701d1f07abeeab125ab93452" ON "webhook_sync_state" ("type")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_56701d1f07abeeab125ab93452"
        `);
    this.addSql(`
            DROP TABLE "webhook_sync_state"
        `);
    this.addSql(`
            DROP TYPE "public"."webhook_sync_state_type_enum"
        `);
  }
}
