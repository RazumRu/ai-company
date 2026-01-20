import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1768900167833 implements MigrationInterface {
  name = 'Generated1768900167833';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "knowledge_docs" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "createdBy" uuid NOT NULL,
                "content" text NOT NULL,
                "title" text NOT NULL,
                "summary" text,
                "tags" jsonb NOT NULL DEFAULT '[]',
                CONSTRAINT "PK_bf3d64994678852fb3de0428abe" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_68cd1c26fb287057a76150f247" ON "knowledge_docs" ("createdBy")
        `);
    await queryRunner.query(`
            CREATE TABLE "knowledge_chunks" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "docId" uuid NOT NULL,
                "chunkIndex" integer NOT NULL,
                "label" character varying,
                "keywords" jsonb,
                "text" text NOT NULL,
                "startOffset" integer NOT NULL,
                "endOffset" integer NOT NULL,
                "embedding" jsonb,
                CONSTRAINT "PK_81af684d79d321813c41019a5cd" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_b00cc8a813624a42dc9fd5e321" ON "knowledge_chunks" ("docId")
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "IDX_a4cfbf5997a69dc9bd11934e7e" ON "knowledge_chunks" ("docId", "chunkIndex")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_a4cfbf5997a69dc9bd11934e7e"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_b00cc8a813624a42dc9fd5e321"
        `);
    await queryRunner.query(`
            DROP TABLE "knowledge_chunks"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_68cd1c26fb287057a76150f247"
        `);
    await queryRunner.query(`
            DROP TABLE "knowledge_docs"
        `);
  }
}
