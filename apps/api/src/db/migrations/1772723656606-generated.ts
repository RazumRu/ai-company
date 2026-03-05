import { MigrationInterface, QueryRunner } from "typeorm";

export class Generated1772723656606 implements MigrationInterface {
    name = 'Generated1772723656606'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "git_repositories"
            ADD "installationId" integer
        `);
        await queryRunner.query(`
            ALTER TABLE "git_repositories"
            ADD "syncedAt" TIMESTAMP WITH TIME ZONE
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "git_repositories" DROP COLUMN "syncedAt"
        `);
        await queryRunner.query(`
            ALTER TABLE "git_repositories" DROP COLUMN "installationId"
        `);
    }

}
