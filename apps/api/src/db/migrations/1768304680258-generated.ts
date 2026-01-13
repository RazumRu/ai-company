import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1768304680258 implements MigrationInterface {
  name = 'Generated1768304680258';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "answeredToolCallNames" text
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "messages" DROP COLUMN "answeredToolCallNames"
        `);
  }
}
