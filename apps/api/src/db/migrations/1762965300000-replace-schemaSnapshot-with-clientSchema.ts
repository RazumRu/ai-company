import { Migration } from '@mikro-orm/migrations';

export class ReplaceSchemaSnapshotWithClientSchema1762965300000 extends Migration {
  override async up(): Promise<void> {
    // Add clientSchema column (nullable first)
    this.addSql(`
      ALTER TABLE "graph_revisions"
      ADD "clientSchema" jsonb
    `);

    // Copy newSchema to clientSchema for existing rows
    // (These won't enable re-merge, but prevent NULL values)
    this.addSql(`
      UPDATE "graph_revisions"
      SET "clientSchema" = "newSchema"
      WHERE "clientSchema" IS NULL
    `);

    // Make clientSchema NOT NULL
    this.addSql(`
      ALTER TABLE "graph_revisions"
      ALTER COLUMN "clientSchema" SET NOT NULL
    `);

    // Drop schemaSnapshot column (it was redundant duplicate of newSchema)
    this.addSql(`
      ALTER TABLE "graph_revisions"
      DROP COLUMN "schemaSnapshot"
    `);
  }

  override async down(): Promise<void> {
    // Re-add schemaSnapshot column
    this.addSql(`
      ALTER TABLE "graph_revisions"
      ADD "schemaSnapshot" jsonb
    `);

    // Copy newSchema back to schemaSnapshot
    this.addSql(`
      UPDATE "graph_revisions"
      SET "schemaSnapshot" = "newSchema"
      WHERE "schemaSnapshot" IS NULL
    `);

    // Make schemaSnapshot NOT NULL
    this.addSql(`
      ALTER TABLE "graph_revisions"
      ALTER COLUMN "schemaSnapshot" SET NOT NULL
    `);

    // Drop clientSchema column
    this.addSql(`
      ALTER TABLE "graph_revisions"
      DROP COLUMN "clientSchema"
    `);
  }
}
