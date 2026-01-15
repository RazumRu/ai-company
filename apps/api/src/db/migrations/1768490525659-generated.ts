import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1768490525659 implements MigrationInterface {
  name = 'Generated1768490525659';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "runtime_instances" DROP COLUMN "metadata"
        `);
    await queryRunner.query(`
            ALTER TABLE "runtime_instances" DROP COLUMN "version"
        `);
    await queryRunner.query(`
            ALTER TABLE "runtime_instances"
            ADD "temporary" boolean NOT NULL DEFAULT false
        `);
    await queryRunner.query(`
            ALTER TABLE "runtime_instances"
            ALTER COLUMN "config"
            SET NOT NULL
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_runtime_instances_temporary" ON "runtime_instances" ("temporary")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_runtime_instances_temporary"
        `);
    await queryRunner.query(`
            ALTER TABLE "runtime_instances"
            ALTER COLUMN "config" DROP NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "runtime_instances" DROP COLUMN "temporary"
        `);
    await queryRunner.query(`
            ALTER TABLE "runtime_instances"
            ADD "version" character varying(50) NOT NULL
        `);
    await queryRunner.query(`
            ALTER TABLE "runtime_instances"
            ADD "metadata" jsonb
        `);
  }
}
