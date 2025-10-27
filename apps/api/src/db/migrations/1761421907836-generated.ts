import { MigrationInterface, QueryRunner } from 'typeorm';

export class Generated1761421907836 implements MigrationInterface {
  name = 'Generated1761421907836';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "threads" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "graphId" uuid NOT NULL,
                "createdBy" uuid NOT NULL,
                "externalThreadId" character varying NOT NULL,
                "metadata" jsonb,
                CONSTRAINT "PK_d8a74804c34fc3900502cd27275" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_6702c6b1e71ab29e5103028183" ON "threads" ("graphId")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_d288e139037a4de52d00e42e78" ON "threads" ("createdBy")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_2aecc6fa23e93aacd536433927" ON "threads" ("externalThreadId")
        `);
    await queryRunner.query(`
            CREATE TABLE "messages" (
                "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deletedAt" TIMESTAMP WITH TIME ZONE,
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "threadId" uuid NOT NULL,
                "externalThreadId" character varying NOT NULL,
                "nodeId" character varying NOT NULL,
                "message" jsonb NOT NULL,
                CONSTRAINT "PK_18325f38ae6de43878487eff986" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_15f9bd2bf472ff12b6ee20012d" ON "messages" ("threadId")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_0d56ed722567bad03618f7e02b" ON "messages" ("externalThreadId")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_7f5346b8f042a49c31dbf19870" ON "messages" ("nodeId")
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."IDX_7f5346b8f042a49c31dbf19870"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_0d56ed722567bad03618f7e02b"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_15f9bd2bf472ff12b6ee20012d"
        `);
    await queryRunner.query(`
            DROP TABLE "messages"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_2aecc6fa23e93aacd536433927"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_d288e139037a4de52d00e42e78"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_6702c6b1e71ab29e5103028183"
        `);
    await queryRunner.query(`
            DROP TABLE "threads"
        `);
  }
}
