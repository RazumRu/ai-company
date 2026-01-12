import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1768206581388 implements MigrationInterface {
  name = 'Generated1768206581388';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_graph_checkpoints_parentThreadId"
        `);
    await queryRunner.query(`
            ALTER TABLE "messages" DROP COLUMN "requestUsage"
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_3cab3aab51c7394a1133560768" ON "graph_checkpoints" ("parentThreadId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_3cab3aab51c7394a1133560768"
        `);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "requestUsage" jsonb
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_graph_checkpoints_parentThreadId" ON "graph_checkpoints" ("parentThreadId")
        `);
  }
}
