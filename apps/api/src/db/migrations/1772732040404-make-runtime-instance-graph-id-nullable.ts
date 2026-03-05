import { MigrationInterface, QueryRunner } from "typeorm";

export class MakeRuntimeInstanceGraphIdNullable1772732040404 implements MigrationInterface {
    name = 'MakeRuntimeInstanceGraphIdNullable1772732040404'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "public"."IDX_edbcf394ee253b1671a282b5ec"
        `);
        await queryRunner.query(`
            ALTER TABLE "runtime_instances"
            ALTER COLUMN "graphId" DROP NOT NULL
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_edbcf394ee253b1671a282b5ec" ON "runtime_instances" ("graphId", "nodeId", "threadId") NULLS NOT DISTINCT
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "public"."IDX_edbcf394ee253b1671a282b5ec"
        `);
        await queryRunner.query(`
            ALTER TABLE "runtime_instances"
            ALTER COLUMN "graphId"
            SET NOT NULL
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_edbcf394ee253b1671a282b5ec" ON "runtime_instances" ("graphId", "nodeId", "threadId")
        `);
    }

}
