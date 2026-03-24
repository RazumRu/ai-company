import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1774335741918 implements MigrationInterface {
  name = 'Generated1774335741918';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "webhook_sync_state"
                RENAME COLUMN "last_sync_date" TO "lastSyncDate"
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "webhook_sync_state"
                RENAME COLUMN "lastSyncDate" TO "last_sync_date"
        `);
  }
}
