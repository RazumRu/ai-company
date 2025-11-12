import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1762944001280 implements MigrationInterface {
  name = 'Generated1762944001280';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add targetVersion column to graphs table
    await queryRunner.query(`
        ALTER TABLE "graphs"
          ADD COLUMN "targetVersion" character varying(50)
      `);

    // Set targetVersion to current version for existing graphs
    await queryRunner.query(`
      UPDATE "graphs"
      SET "targetVersion" = "version"
    `);

    // Make the column NOT NULL after setting initial values
    await queryRunner.query(`
      ALTER TABLE "graphs"
      ALTER COLUMN "targetVersion" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "graphs" DROP COLUMN "targetVersion"
        `);
  }
}
