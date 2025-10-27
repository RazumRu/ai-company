import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1761511170801 implements MigrationInterface {
  name = 'Generated1761511170801';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_2aecc6fa23e93aacd536433927"
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_2aecc6fa23e93aacd536433927" ON "threads" ("externalThreadId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_2aecc6fa23e93aacd536433927"
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_2aecc6fa23e93aacd536433927" ON "threads" ("externalThreadId")
        `);
  }
}
