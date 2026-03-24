import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1774281863983 implements MigrationInterface {
  name = 'Generated1774281863983';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."webhook_sync_state_type_enum" AS ENUM('gh_issue')
        `);
    await queryRunner.query(`
            CREATE TABLE "webhook_sync_state" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "type" "public"."webhook_sync_state_type_enum" NOT NULL,
                "last_sync_date" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_3bd41d8a9ef8efb2231365c59fc" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_56701d1f07abeeab125ab93452" ON "webhook_sync_state" ("type")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_56701d1f07abeeab125ab93452"
        `);
    await queryRunner.query(`
            DROP TABLE "webhook_sync_state"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."webhook_sync_state_type_enum"
        `);
  }
}
