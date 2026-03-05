import { MigrationInterface, QueryRunner } from "typeorm";

export class Generated1772727311658 implements MigrationInterface {
    name = 'Generated1772727311658'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "git_repositories" DROP COLUMN "encryptedToken"
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "git_repositories"
            ADD "encryptedToken" text
        `);
    }

}
