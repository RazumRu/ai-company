import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGraphAgentsColumn1772538380484 implements MigrationInterface {
  name = 'AddGraphAgentsColumn1772538380484';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "graphs"
            ADD "agents" jsonb
        `);

    await queryRunner.query(`
            UPDATE "graphs"
            SET "agents" = (
                SELECT COALESCE(jsonb_agg(
                    jsonb_build_object(
                        'nodeId', node->>'id',
                        'name', COALESCE(node->'config'->>'name', node->>'template'),
                        'description', node->'config'->>'description'
                    )
                ), '[]'::jsonb)
                FROM jsonb_array_elements("graphs"."schema"->'nodes') AS node
                WHERE node->>'template' = 'simple-agent'
            )
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "graphs" DROP COLUMN "agents"
        `);
  }
}
