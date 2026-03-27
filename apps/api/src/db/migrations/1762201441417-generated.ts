import { Migration } from '@mikro-orm/migrations';

export class Generated1762201441417 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "threads"
            ADD "status" character varying NOT NULL DEFAULT 'running'
        `);
    this.addSql(`
            CREATE INDEX "IDX_c69829dccdf02bb79717b83271" ON "threads" ("status")
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            DROP INDEX "public"."IDX_c69829dccdf02bb79717b83271"
        `);
    this.addSql(`
            ALTER TABLE "threads" DROP COLUMN "status"
        `);
  }
}
