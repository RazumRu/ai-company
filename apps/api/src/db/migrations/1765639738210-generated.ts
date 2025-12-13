import { MigrationInterface, QueryRunner } from "typeorm";

export class Generated1765639738210 implements MigrationInterface {
    name = 'Generated1765639738210'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "threads"
            ADD "lastRunId" uuid
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "threads" DROP COLUMN "lastRunId"
        `);
    }

}
