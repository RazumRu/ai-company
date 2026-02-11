import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1770793814179 implements MigrationInterface {
  name = 'Generated1770793814179';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Clean up orphaned threads first (graphId references non-existent graph)
    await queryRunner.query(`
            DELETE FROM "threads"
            WHERE "graphId" NOT IN (SELECT "id" FROM "graphs")
        `);
    // Then clean up orphaned messages (threadId references non-existent thread,
    // including messages whose thread was just deleted above)
    await queryRunner.query(`
            DELETE FROM "messages"
            WHERE "threadId" NOT IN (SELECT "id" FROM "threads")
        `);
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD CONSTRAINT "FK_6702c6b1e71ab29e51030281832" FOREIGN KEY ("graphId") REFERENCES "graphs"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD CONSTRAINT "FK_15f9bd2bf472ff12b6ee20012d0" FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "messages" DROP CONSTRAINT "FK_15f9bd2bf472ff12b6ee20012d0"
        `);
    await queryRunner.query(`
            ALTER TABLE "threads" DROP CONSTRAINT "FK_6702c6b1e71ab29e51030281832"
        `);
  }
}
