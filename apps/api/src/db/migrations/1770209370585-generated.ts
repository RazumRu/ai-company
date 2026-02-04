import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1770209370585 implements MigrationInterface {
  name = 'Generated1770209370585';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TYPE "public"."repo_indexes_status_enum" AS ENUM('pending', 'in_progress', 'completed', 'failed')
        `);
    await queryRunner.query(`
            CREATE TABLE "repo_indexes" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "repositoryId" uuid NOT NULL,
                "repoUrl" character varying NOT NULL,
                "status" "public"."repo_indexes_status_enum" NOT NULL,
                "qdrantCollection" character varying NOT NULL,
                "lastIndexedCommit" character varying,
                "embeddingModel" character varying,
                "vectorSize" integer,
                "chunkingSignatureHash" character varying,
                "estimatedTokens" integer,
                "errorMessage" text,
                CONSTRAINT "UQ_001a3ccf8144b1061e35a7a7b5b" UNIQUE ("repositoryId"),
                CONSTRAINT "PK_3918e335f71f09612e28cb8e8e7" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            ALTER TABLE "git_repositories"
            ADD "encryptedToken" text
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "git_repositories" DROP COLUMN "encryptedToken"
        `);
    await queryRunner.query(`
            DROP TABLE "repo_indexes"
        `);
    await queryRunner.query(`
            DROP TYPE "public"."repo_indexes_status_enum"
        `);
  }
}
