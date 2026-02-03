import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1770117238302 implements MigrationInterface {
  name = 'Generated1770117238302';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."git_repositories_provider_enum" AS ENUM('GITHUB')
        `);
    await queryRunner.query(`
            CREATE TABLE "git_repositories" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "owner" character varying NOT NULL,
                "repo" character varying NOT NULL,
                "url" character varying NOT NULL,
                "provider" "public"."git_repositories_provider_enum" NOT NULL,
                "createdBy" uuid NOT NULL,
                CONSTRAINT "PK_6da02a2f669e59fecb5366c0031" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_ac33bc6a5803234be00dc839bc" ON "git_repositories" ("owner")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_d9121f1e2ce469c0f140253b0f" ON "git_repositories" ("repo")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_cdd40dd1e9a0c0ea2d77ea9f48" ON "git_repositories" ("createdBy")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_0c83196e1a740179647ff52872" ON "git_repositories" ("owner", "repo", "createdBy", "provider")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_0c83196e1a740179647ff52872"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_cdd40dd1e9a0c0ea2d77ea9f48"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_d9121f1e2ce469c0f140253b0f"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_ac33bc6a5803234be00dc839bc"
        `);
    await queryRunner.query(`
            DROP TABLE "git_repositories"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."git_repositories_provider_enum"
        `);
  }
}
