import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1772184988783 implements MigrationInterface {
  name = 'Generated1772184988783';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add projectId as nullable first so existing rows don't violate NOT NULL
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD "projectId" uuid
        `);

    // Populate projectId for existing threads from their associated graph
    await queryRunner.query(`
            UPDATE "threads"
            SET "projectId" = "graphs"."projectId"
            FROM "graphs"
            WHERE "threads"."graphId" = "graphs"."id"
        `);

    // Now set NOT NULL after all rows are populated
    await queryRunner.query(`
            ALTER TABLE "threads"
            ALTER COLUMN "projectId" SET NOT NULL
        `);

    await queryRunner.query(`
            CREATE INDEX "IDX_3acbab3c91ef7c75eb0709f44f" ON "threads" ("projectId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_3acbab3c91ef7c75eb0709f44f"
        `);
    await queryRunner.query(`
            ALTER TABLE "threads" DROP COLUMN "projectId"
        `);
  }
}
