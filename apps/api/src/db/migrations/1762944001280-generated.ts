import { Migration } from '@mikro-orm/migrations';

export class Generated1762944001280 extends Migration {
  override async up(): Promise<void> {
    // Add targetVersion column to graphs table
    this.addSql(`
        ALTER TABLE "graphs"
          ADD COLUMN "targetVersion" character varying(50)
      `);

    // Set targetVersion to current version for existing graphs
    this.addSql(`
      UPDATE "graphs"
      SET "targetVersion" = "version"
    `);

    // Make the column NOT NULL after setting initial values
    this.addSql(`
      ALTER TABLE "graphs"
      ALTER COLUMN "targetVersion" SET NOT NULL
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "graphs" DROP COLUMN "targetVersion"
        `);
  }
}
