import { Migration } from '@mikro-orm/migrations';

export class Generated1770380919707 extends Migration {
  override async up(): Promise<void> {
    // Clean up orphaned indexes (where repositoryId doesn't exist in git_repositories)
    this.addSql(`
            DELETE FROM "repo_indexes"
            WHERE "repositoryId" NOT IN (SELECT "id" FROM "git_repositories")
        `);

    // Add foreign key constraint
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ADD CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b" FOREIGN KEY ("repositoryId") REFERENCES "git_repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "repo_indexes" DROP CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b"
        `);
  }
}
