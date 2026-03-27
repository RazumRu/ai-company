import { Migration } from '@mikro-orm/migrations';

export class Generated1762375281897 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TYPE "public"."graphs_status_enum"
            RENAME TO "graphs_status_enum_old"
        `);
    this.addSql(`
            CREATE TYPE "public"."graphs_status_enum" AS ENUM(
                'created',
                'compiling',
                'running',
                'stopped',
                'error'
            )
        `);
    this.addSql(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status" DROP DEFAULT
        `);
    this.addSql(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status" TYPE "public"."graphs_status_enum" USING "status"::"text"::"public"."graphs_status_enum"
        `);
    this.addSql(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status"
            SET DEFAULT 'created'
        `);
    this.addSql(`
            DROP TYPE "public"."graphs_status_enum_old"
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            CREATE TYPE "public"."graphs_status_enum_old" AS ENUM('created', 'running', 'stopped', 'error')
        `);
    this.addSql(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status" DROP DEFAULT
        `);
    this.addSql(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status" TYPE "public"."graphs_status_enum_old" USING "status"::"text"::"public"."graphs_status_enum_old"
        `);
    this.addSql(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status"
            SET DEFAULT 'created'
        `);
    this.addSql(`
            DROP TYPE "public"."graphs_status_enum"
        `);
    this.addSql(`
            ALTER TYPE "public"."graphs_status_enum_old"
            RENAME TO "graphs_status_enum"
        `);
  }
}
