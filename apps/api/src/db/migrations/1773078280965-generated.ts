import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1773078280965 implements MigrationInterface {
  name = 'Generated1773078280965';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "user_preference" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "userId" character varying NOT NULL,
                "preferences" jsonb NOT NULL DEFAULT '{}',
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_0532217bd629d0ccf06499c5841" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_5b141fbd1fef95a0540f7e7d1e" ON "user_preference" ("userId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_5b141fbd1fef95a0540f7e7d1e"
        `);
    await queryRunner.query(`
            DROP TABLE "user_preference"
        `);
  }
}
