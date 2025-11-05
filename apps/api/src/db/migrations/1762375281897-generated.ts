import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1762375281897 implements MigrationInterface {
  name = 'Generated1762375281897';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TYPE "public"."graphs_status_enum"
            RENAME TO "graphs_status_enum_old"
        `);
    await queryRunner.query(`
            CREATE TYPE "public"."graphs_status_enum" AS ENUM(
                'created',
                'compiling',
                'running',
                'stopped',
                'error'
            )
        `);
    await queryRunner.query(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status" DROP DEFAULT
        `);
    await queryRunner.query(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status" TYPE "public"."graphs_status_enum" USING "status"::"text"::"public"."graphs_status_enum"
        `);
    await queryRunner.query(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status"
            SET DEFAULT 'created'
        `);
    await queryRunner.query(`
            DROP TYPE "public"."graphs_status_enum_old"
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."graphs_status_enum_old" AS ENUM('created', 'running', 'stopped', 'error')
        `);
    await queryRunner.query(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status" DROP DEFAULT
        `);
    await queryRunner.query(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status" TYPE "public"."graphs_status_enum_old" USING "status"::"text"::"public"."graphs_status_enum_old"
        `);
    await queryRunner.query(`
            ALTER TABLE "graphs"
            ALTER COLUMN "status"
            SET DEFAULT 'created'
        `);
    await queryRunner.query(`
            DROP TYPE "public"."graphs_status_enum"
        `);
    await queryRunner.query(`
            ALTER TYPE "public"."graphs_status_enum_old"
            RENAME TO "graphs_status_enum"
        `);
  }
}
