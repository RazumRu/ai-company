import { Migration } from '@mikro-orm/migrations';

export class GraphRevisionConfig1767026178813 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ADD "configDiff" jsonb
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ADD "clientConfig" jsonb
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ADD "newConfig" jsonb
        `);
    this.addSql(`
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
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "configDiff" SET NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "clientConfig" SET NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "newConfig" SET NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions" DROP COLUMN "configurationDiff"
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions" DROP COLUMN "newSchema"
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions" DROP COLUMN "clientSchema"
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ADD "clientSchema" jsonb
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ADD "newSchema" jsonb
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ADD "configurationDiff" jsonb
        `);
    this.addSql(`
            UPDATE "graph_revisions"
            SET
                "configurationDiff" = "configDiff",
                "clientSchema" = ("clientConfig"->'schema'),
                "newSchema" = ("newConfig"->'schema')
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "clientSchema" SET NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "newSchema" SET NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ALTER COLUMN "configurationDiff" SET NOT NULL
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions" DROP COLUMN "newConfig"
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions" DROP COLUMN "clientConfig"
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions" DROP COLUMN "configDiff"
        `);
  }
}
