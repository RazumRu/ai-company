import { Migration } from '@mikro-orm/migrations';

export class AddGraphAgentsColumn1772538380484 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
            ALTER TABLE "graphs"
            ADD "agents" jsonb
        `);

    this.addSql(`
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

  override async down(): Promise<void> {
    this.addSql(`
            ALTER TABLE "graphs" DROP COLUMN "agents"
        `);
  }
}
