import { Migration } from '@mikro-orm/migrations';

export class Generated1774348036484 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            CREATE TABLE "webhook_processed_event" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "dedupKey" character varying NOT NULL,
                CONSTRAINT "PK_5df39edcb5c377e4d91dee097ea" PRIMARY KEY ("id")
            )
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_0b1a099caaca931750e46b4c3c" ON "webhook_processed_event" ("dedupKey")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_0b1a099caaca931750e46b4c3c"
        `);
    this.addSql(`
            DROP TABLE "webhook_processed_event"
        `);
  }
}
