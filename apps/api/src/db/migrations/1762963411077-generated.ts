import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1762963411077 implements MigrationInterface {
  name = 'Generated1762963411077';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "graph_revisions" DROP COLUMN "fromVersion"
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ADD "baseVersion" character varying(50)
        `);

    await queryRunner.query(`
      UPDATE "graph_revisions"
        SET "baseVersion"="toVersion"
    `);

    await queryRunner.query(`
      ALTER TABLE "graph_revisions"
        ALTER COLUMN "baseVersion" SET NOT NULL
    `);

    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ADD "schemaSnapshot" jsonb
        `);

    await queryRunner.query(`
      UPDATE "graph_revisions"
      SET "schemaSnapshot"='{}'
    `);

    await queryRunner.query(`
      ALTER TABLE "graph_revisions"
        ALTER COLUMN "schemaSnapshot" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "graph_revisions" DROP COLUMN "schemaSnapshot"
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions" DROP COLUMN "baseVersion"
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ADD "fromVersion" character varying(50) NOT NULL
        `);
  }
}
