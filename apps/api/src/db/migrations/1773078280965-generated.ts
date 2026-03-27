import { Migration } from '@mikro-orm/migrations';

export class Generated1773078280965 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            CREATE TABLE "user_preference" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "userId" character varying NOT NULL,
                "preferences" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_0532217bd629d0ccf06499c5841" PRIMARY KEY ("id")
            )
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_5b141fbd1fef95a0540f7e7d1e" ON "user_preference" ("userId")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_5b141fbd1fef95a0540f7e7d1e"
        `);
    this.addSql(`
            DROP TABLE "user_preference"
        `);
  }
}
