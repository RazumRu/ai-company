import { Migration } from '@mikro-orm/migrations';

export class Generated1762963411077 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "graph_revisions" DROP COLUMN "fromVersion"
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ADD "baseVersion" character varying(50)
        `);

    this.addSql(`
      UPDATE "graph_revisions"
        SET "baseVersion"="toVersion"
    `);

    this.addSql(`
      ALTER TABLE "graph_revisions"
        ALTER COLUMN "baseVersion" SET NOT NULL
    `);

    this.addSql(`
            ALTER TABLE "graph_revisions"
            ADD "schemaSnapshot" jsonb
        `);

    this.addSql(`
      UPDATE "graph_revisions"
      SET "schemaSnapshot"='{}'
    `);

    this.addSql(`
      ALTER TABLE "graph_revisions"
        ALTER COLUMN "schemaSnapshot" SET NOT NULL
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "graph_revisions" DROP COLUMN "schemaSnapshot"
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions" DROP COLUMN "baseVersion"
        `);
    this.addSql(`
            ALTER TABLE "graph_revisions"
            ADD "fromVersion" character varying(50) NOT NULL
        `);
  }
}
