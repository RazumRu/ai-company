import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1774348036484 implements MigrationInterface {
  name = 'Generated1774348036484';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "webhook_processed_event" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "dedupKey" character varying NOT NULL,
                CONSTRAINT "PK_5df39edcb5c377e4d91dee097ea" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_0b1a099caaca931750e46b4c3c" ON "webhook_processed_event" ("dedupKey")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_0b1a099caaca931750e46b4c3c"
        `);
    await queryRunner.query(`
            DROP TABLE "webhook_processed_event"
        `);
  }
}
