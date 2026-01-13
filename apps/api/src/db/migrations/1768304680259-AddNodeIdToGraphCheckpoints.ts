import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNodeIdToGraphCheckpoints1768304680259 implements MigrationInterface {
  name = 'AddNodeIdToGraphCheckpoints1768304680259';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add nodeId column to graph_checkpoints table
    await queryRunner.query(`
            ALTER TABLE "graph_checkpoints"
            ADD COLUMN "nodeId" VARCHAR
        `);

    // Create index on nodeId for efficient lookups
    await queryRunner.query(`
            CREATE INDEX "IDX_graph_checkpoints_nodeId"
            ON "graph_checkpoints" ("nodeId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index first
    await queryRunner.query(`
            DROP INDEX "IDX_graph_checkpoints_nodeId"
        `);

    // Drop column
    await queryRunner.query(`
            ALTER TABLE "graph_checkpoints"
            DROP COLUMN "nodeId"
        `);
  }
}
