import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1768473238699 implements MigrationInterface {
  name = 'Generated1768473238699';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_graph_checkpoints_nodeId"
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."runtime_instances_type_enum" AS ENUM('Docker')
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."runtime_instances_status_enum" AS ENUM('Starting', 'Running', 'Stopping', 'Stopped')
        `);
    await queryRunner.query(`
            CREATE TABLE "runtime_instances" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "graphId" uuid NOT NULL,
                "nodeId" character varying NOT NULL,
                "threadId" character varying NOT NULL,
                "type" "public"."runtime_instances_type_enum" NOT NULL,
                "containerName" character varying(255) NOT NULL,
                "status" "public"."runtime_instances_status_enum" NOT NULL DEFAULT 'Starting',
                "config" jsonb,
                "metadata" jsonb,
                "lastUsedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "version" character varying(50) NOT NULL,
                CONSTRAINT "PK_8e1870b299a3796fe59b78d2c37" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_9d7d3e71a836499597201eb7ca" ON "runtime_instances" ("graphId")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_9c8681731cc6cc3f8e1d8616ee" ON "runtime_instances" ("threadId")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_cc42483a7c938297472ef633c9" ON "runtime_instances" ("status")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_aee88a311dcb1339c9c5d7314b" ON "runtime_instances" ("lastUsedAt")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_edbcf394ee253b1671a282b5ec" ON "runtime_instances" ("graphId", "nodeId", "threadId")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_bf2c48c6e6ae3bffe3b737dbda" ON "graph_checkpoints" ("nodeId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_bf2c48c6e6ae3bffe3b737dbda"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_edbcf394ee253b1671a282b5ec"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_aee88a311dcb1339c9c5d7314b"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_cc42483a7c938297472ef633c9"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_9c8681731cc6cc3f8e1d8616ee"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_9d7d3e71a836499597201eb7ca"
        `);
    await queryRunner.query(`
            DROP TABLE "runtime_instances"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."runtime_instances_status_enum"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."runtime_instances_type_enum"
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_graph_checkpoints_nodeId" ON "graph_checkpoints" ("nodeId")
        `);
  }
}
