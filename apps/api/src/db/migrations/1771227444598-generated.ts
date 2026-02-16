import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1771227444598 implements MigrationInterface {
  name = 'Generated1771227444598';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "toolCallIds" text
        `);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "additionalKwargs" jsonb
        `);
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "toolTokenUsage" jsonb
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "messages" DROP COLUMN "toolTokenUsage"
        `);
    await queryRunner.query(`
            ALTER TABLE "messages" DROP COLUMN "additionalKwargs"
        `);
    await queryRunner.query(`
            ALTER TABLE "messages" DROP COLUMN "toolCallIds"
        `);
  }
}
