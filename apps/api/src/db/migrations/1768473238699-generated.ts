import { Migration } from '@mikro-orm/migrations';

export class Generated1768473238699 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_graph_checkpoints_nodeId"
        `);
    this.addSql(`
            CREATE TYPE "public"."runtime_instances_type_enum" AS ENUM('Docker')
        `);
    this.addSql(`
            CREATE TYPE "public"."runtime_instances_status_enum" AS ENUM('Starting', 'Running', 'Stopping', 'Stopped')
        `);
    this.addSql(`
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
    this.addSql(`
            CREATE INDEX "IDX_9d7d3e71a836499597201eb7ca" ON "runtime_instances" ("graphId")
        `);
    this.addSql(`
            CREATE INDEX "IDX_9c8681731cc6cc3f8e1d8616ee" ON "runtime_instances" ("threadId")
        `);
    this.addSql(`
            CREATE INDEX "IDX_cc42483a7c938297472ef633c9" ON "runtime_instances" ("status")
        `);
    this.addSql(`
            CREATE INDEX "IDX_aee88a311dcb1339c9c5d7314b" ON "runtime_instances" ("lastUsedAt")
        `);
    this.addSql(`
            CREATE UNIQUE INDEX "IDX_edbcf394ee253b1671a282b5ec" ON "runtime_instances" ("graphId", "nodeId", "threadId")
        `);
    this.addSql(`
            CREATE INDEX "IDX_bf2c48c6e6ae3bffe3b737dbda" ON "graph_checkpoints" ("nodeId")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_bf2c48c6e6ae3bffe3b737dbda"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_edbcf394ee253b1671a282b5ec"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_aee88a311dcb1339c9c5d7314b"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_cc42483a7c938297472ef633c9"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_9c8681731cc6cc3f8e1d8616ee"
        `);
    this.addSql(`
            DROP INDEX "public"."IDX_9d7d3e71a836499597201eb7ca"
        `);
    this.addSql(`
            DROP TABLE "runtime_instances"
        `);
    this.addSql(`
            DROP TYPE "public"."runtime_instances_status_enum"
        `);
    this.addSql(`
            DROP TYPE "public"."runtime_instances_type_enum"
        `);
    this.addSql(`
            CREATE INDEX "IDX_graph_checkpoints_nodeId" ON "graph_checkpoints" ("nodeId")
        `);
  }
}
