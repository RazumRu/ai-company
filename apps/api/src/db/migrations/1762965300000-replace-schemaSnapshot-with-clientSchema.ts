import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceSchemaSnapshotWithClientSchema1762965300000
  implements MigrationInterface
{
  name = 'ReplaceSchemaSnapshotWithClientSchema1762965300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add clientSchema column (nullable first)
    await queryRunner.query(`
      ALTER TABLE "graph_revisions"
      ADD "clientSchema" jsonb
    `);

    // Copy newSchema to clientSchema for existing rows
    // (These won't enable re-merge, but prevent NULL values)
    await queryRunner.query(`
      UPDATE "graph_revisions"
      SET "clientSchema" = "newSchema"
      WHERE "clientSchema" IS NULL
    `);

    // Make clientSchema NOT NULL
    await queryRunner.query(`
      ALTER TABLE "graph_revisions"
      ALTER COLUMN "clientSchema" SET NOT NULL
    `);

    // Drop schemaSnapshot column (it was redundant duplicate of newSchema)
    await queryRunner.query(`
      ALTER TABLE "graph_revisions"
      DROP COLUMN "schemaSnapshot"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add schemaSnapshot column
    await queryRunner.query(`
      ALTER TABLE "graph_revisions"
      ADD "schemaSnapshot" jsonb
    `);

    // Copy newSchema back to schemaSnapshot
    await queryRunner.query(`
      UPDATE "graph_revisions"
      SET "schemaSnapshot" = "newSchema"
      WHERE "schemaSnapshot" IS NULL
    `);

    // Make schemaSnapshot NOT NULL
    await queryRunner.query(`
      ALTER TABLE "graph_revisions"
      ALTER COLUMN "schemaSnapshot" SET NOT NULL
    `);

    // Drop clientSchema column
    await queryRunner.query(`
      ALTER TABLE "graph_revisions"
      DROP COLUMN "clientSchema"
    `);
  }
}
