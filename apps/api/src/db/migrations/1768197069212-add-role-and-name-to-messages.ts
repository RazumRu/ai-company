import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoleAndNameToMessages1768197069212 implements MigrationInterface {
  name = 'AddRoleAndNameToMessages1768197069212';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add role and name columns
    await queryRunner.query(`
            ALTER TABLE "messages"
            ADD "role" varchar,
            ADD "name" varchar
        `);

    // Populate role from message.role
    await queryRunner.query(`
            UPDATE "messages"
            SET "role" = (message ->> 'role')
            WHERE message ? 'role'
        `);

    // Populate name from message.name
    await queryRunner.query(`
            UPDATE "messages"
            SET "name" = (message ->> 'name')
            WHERE message ? 'name'
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "messages"
            DROP COLUMN "role",
            DROP COLUMN "name"
        `);
  }
}
