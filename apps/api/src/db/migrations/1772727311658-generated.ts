import { Migration } from '@mikro-orm/migrations';

export class Generated1772727311658 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "git_repositories" DROP COLUMN "encryptedToken"
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "git_repositories"
            ADD "encryptedToken" text
        `);
  }
}
