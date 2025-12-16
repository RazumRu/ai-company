import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1765733379573 implements MigrationInterface {
  name = 'Generated1765733379573';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "threads"
            ADD "tokenUsage" jsonb
        `);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "tokenUsage" jsonb
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "messages" DROP COLUMN "tokenUsage"
        `);
    await queryRunner.query(`
            ALTER TABLE "threads" DROP COLUMN "tokenUsage"
        `);
  }
}
