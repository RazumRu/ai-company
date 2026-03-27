import { Migration } from '@mikro-orm/migrations';

export class Generated1770280518340 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "repo_indexes"
            ADD "indexedTokens" integer DEFAULT '0'
        `);
  }

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "repo_indexes" DROP COLUMN "indexedTokens"
        `);
  }
}
