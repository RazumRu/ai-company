import { MigrationInterface, QueryRunner } from 'typeorm';

export class GraphRevisionConfig1767026178813 implements MigrationInterface {
  name = 'GraphRevisionConfig1767026178813';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ADD "configDiff" jsonb
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ADD "clientConfig" jsonb
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ADD "newConfig" jsonb
        `);
    await queryRunner.query(`
            UPDATE "graph_revisions" r
            SET
                "configDiff" = r."configurationDiff",
                "clientConfig" = jsonb_build_object(
                    'schema', r."clientSchema",
                    'name', g."name",
                    'description', g."description",
                    'temporary', g."temporary"
                ),
                "newConfig" = jsonb_build_object(
                    'schema', r."newSchema",
                    'name', g."name",
                    'description', g."description",
                    'temporary', g."temporary"
                )
            FROM "graphs" g
            WHERE g."id" = r."graphId"
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "configDiff" SET NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "clientConfig" SET NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "newConfig" SET NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions" DROP COLUMN "configurationDiff"
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions" DROP COLUMN "newSchema"
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions" DROP COLUMN "clientSchema"
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ADD "clientSchema" jsonb
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ADD "newSchema" jsonb
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ADD "configurationDiff" jsonb
        `);
    await queryRunner.query(`
            UPDATE "graph_revisions"
            SET
                "configurationDiff" = "configDiff",
                "clientSchema" = ("clientConfig"->'schema'),
                "newSchema" = ("newConfig"->'schema')
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "clientSchema" SET NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "newSchema" SET NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "configurationDiff" SET NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions" DROP COLUMN "newConfig"
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions" DROP COLUMN "clientConfig"
        `);
    await queryRunner.query(`
            ALTER TABLE "graph_revisions" DROP COLUMN "configDiff"
        `);
  }
}
