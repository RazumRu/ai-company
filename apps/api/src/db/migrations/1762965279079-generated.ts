import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1762965279079 implements MigrationInterface {
  name = 'Generated1762965279079';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE INDEX "IDX_31c0acef25b5e1204c253aaad1" ON "graph_revisions" ("graphId", "toVersion")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_31c0acef25b5e1204c253aaad1"
        `);
  }
}
