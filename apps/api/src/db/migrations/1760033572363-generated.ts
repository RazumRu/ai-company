import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1760033572363 implements MigrationInterface {
  name = 'Generated1760033572363';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."graphs_status_enum" AS ENUM('created', 'running', 'stopped', 'error')
        `);
    await queryRunner.query(`
            CREATE TABLE "graphs" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying(255) NOT NULL,
                "description" text,
                "error" text,
                "version" character varying(50) NOT NULL,
                "schema" jsonb NOT NULL,
                "status" "public"."graphs_status_enum" NOT NULL DEFAULT 'created',
                "metadata" jsonb,
                "createdBy" uuid NOT NULL,
                CONSTRAINT "PK_4f32e4f134362de610c87cb99e7" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_4b71a57204c9102cdc0c1a9f51" ON "graphs" ("status")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_2db6fd00099882ad81ce3a5be4" ON "graphs" ("createdBy")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_2db6fd00099882ad81ce3a5be4"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_4b71a57204c9102cdc0c1a9f51"
        `);
    await queryRunner.query(`
            DROP TABLE "graphs"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."graphs_status_enum"
        `);
  }
}
