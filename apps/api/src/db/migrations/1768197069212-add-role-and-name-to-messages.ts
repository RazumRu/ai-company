import { Migration } from '@mikro-orm/migrations';

export class AddRoleAndNameToMessages1768197069212 extends Migration {
  override async up(): Promise<void> {
    // Add role and name columns
    this.addSql(`
            ALTER TABLE "messages"
            ADD "role" varchar,
            ADD "name" varchar
        `);

    // Populate role from message.role
    this.addSql(`
            UPDATE "messages"
            SET "role" = (message ->> 'role')
            WHERE message ? 'role'
        `);

    // Populate name from message.name
    this.addSql(`
            UPDATE "messages"
            SET "name" = (message ->> 'name')
            WHERE message ? 'name'
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "messages"
            DROP COLUMN "role",
            DROP COLUMN "name"
        `);
  }
}
