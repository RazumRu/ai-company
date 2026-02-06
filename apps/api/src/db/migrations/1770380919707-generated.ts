import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1770380919707 implements MigrationInterface {
  name = 'Generated1770380919707';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Clean up orphaned indexes (where repositoryId doesn't exist in git_repositories)
    await queryRunner.query(`
            DELETE FROM "repo_indexes"
            WHERE "repositoryId" NOT IN (SELECT "id" FROM "git_repositories")
        `);

    // Add foreign key constraint
    await queryRunner.query(`
            ALTER TABLE "repo_indexes"
            ADD CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b" FOREIGN KEY ("repositoryId") REFERENCES "git_repositories"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "repo_indexes" DROP CONSTRAINT "FK_001a3ccf8144b1061e35a7a7b5b"
        `);
  }
}
