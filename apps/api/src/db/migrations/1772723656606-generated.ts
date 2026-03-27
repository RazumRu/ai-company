import { Migration } from '@mikro-orm/migrations';

export class Generated1772723656606 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "git_repositories"
            ADD "installationId" integer
        `);
    this.addSql(`
            ALTER TABLE "git_repositories"
            ADD "syncedAt" TIMESTAMP WITH TIME ZONE
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "git_repositories" DROP COLUMN "syncedAt"
        `);
    this.addSql(`
            ALTER TABLE "git_repositories" DROP COLUMN "installationId"
        `);
  }
}
