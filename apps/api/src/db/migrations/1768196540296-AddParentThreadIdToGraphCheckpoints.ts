import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddParentThreadIdToGraphCheckpoints1768196540296 implements MigrationInterface {
  name = 'AddParentThreadIdToGraphCheckpoints1768196540296';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add parentThreadId column to graph_checkpoints table
    await queryRunner.query(`
            ALTER TABLE "graph_checkpoints"
            ADD COLUMN "parentThreadId" VARCHAR
        `);

    // Create index on parentThreadId for efficient lookups
    await queryRunner.query(`
            CREATE INDEX "IDX_graph_checkpoints_parentThreadId"
            ON "graph_checkpoints" ("parentThreadId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop index first
    await queryRunner.query(`
            DROP INDEX "IDX_graph_checkpoints_parentThreadId"
        `);

    // Drop column
    await queryRunner.query(`
            ALTER TABLE "graph_checkpoints"
            DROP COLUMN "parentThreadId"
        `);
  }
}
