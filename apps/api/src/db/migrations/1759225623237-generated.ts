import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1759225623237 implements MigrationInterface {
  name = 'Generated1759225623237';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "graph_checkpoints" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "threadId" character varying NOT NULL,
                "checkpointNs" character varying NOT NULL DEFAULT '',
                "checkpointId" character varying NOT NULL,
                "parentCheckpointId" character varying,
                "type" character varying NOT NULL,
                "checkpoint" bytea NOT NULL,
                "metadata" bytea NOT NULL,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_2739e90f63ccbd3ec1b2b4baf4a" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_5efb40becb5b10edac9b6934c3" ON "graph_checkpoints" ("threadId", "checkpointNs", "checkpointId")
        `);
    await queryRunner.query(`
            CREATE TABLE "graph_checkpoint_writes" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "threadId" character varying NOT NULL,
                "checkpointNs" character varying NOT NULL DEFAULT '',
                "checkpointId" character varying NOT NULL,
                "taskId" character varying NOT NULL,
                "idx" integer NOT NULL,
                "channel" character varying NOT NULL,
                "type" character varying NOT NULL,
                "value" bytea NOT NULL,
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_80475d6b7a7bbf6a3c9c11a1f00" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_bb6786a7e802321198ea9036a0" ON "graph_checkpoint_writes" (
                "threadId",
                "checkpointNs",
                "checkpointId",
                "taskId",
                "idx"
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_bb6786a7e802321198ea9036a0"
        `);
    await queryRunner.query(`
            DROP TABLE "graph_checkpoint_writes"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_5efb40becb5b10edac9b6934c3"
        `);
    await queryRunner.query(`
            DROP TABLE "graph_checkpoints"
        `);
  }
}
