import { Migration } from '@mikro-orm/migrations';

export class RenameDockRuntimeToRuntime1771700000001 extends Migration {
  override async up(): Promise<void> {
    // 1. Update graphs.schema — nodes[].template
    this.addSql(`
      UPDATE "graphs"
      SET "schema" = (
        SELECT jsonb_set(
          "schema",
          '{nodes}',
          (
            SELECT coalesce(jsonb_agg(
              CASE
                WHEN node->>'template' = 'docker-runtime'
                THEN jsonb_set(node, '{template}', '"runtime"')
                ELSE node
              END
              ORDER BY idx
            ), '[]'::jsonb)
            FROM jsonb_array_elements("schema"->'nodes') WITH ORDINALITY AS t(node, idx)
          )
        )
      )
      WHERE "schema"->'nodes' @> '[{"template": "docker-runtime"}]'
    `);

    // 2. Update graph_revisions.clientConfig — clientConfig.schema.nodes[].template
    this.addSql(`
      UPDATE "graph_revisions"
      SET "clientConfig" = jsonb_set(
        "clientConfig",
        '{schema,nodes}',
        (
          SELECT coalesce(jsonb_agg(
            CASE
              WHEN node->>'template' = 'docker-runtime'
              THEN jsonb_set(node, '{template}', '"runtime"')
              ELSE node
            END
            ORDER BY idx
          ), '[]'::jsonb)
          FROM jsonb_array_elements("clientConfig"->'schema'->'nodes') WITH ORDINALITY AS t(node, idx)
        )
      )
      WHERE "clientConfig"->'schema'->'nodes' @> '[{"template": "docker-runtime"}]'
    `);

    // 3. Update graph_revisions.newConfig — newConfig.schema.nodes[].template
    this.addSql(`
      UPDATE "graph_revisions"
      SET "newConfig" = jsonb_set(
        "newConfig",
        '{schema,nodes}',
        (
          SELECT coalesce(jsonb_agg(
            CASE
              WHEN node->>'template' = 'docker-runtime'
              THEN jsonb_set(node, '{template}', '"runtime"')
              ELSE node
            END
            ORDER BY idx
          ), '[]'::jsonb)
          FROM jsonb_array_elements("newConfig"->'schema'->'nodes') WITH ORDINALITY AS t(node, idx)
        )
      )
      WHERE "newConfig" IS NOT NULL
        AND "newConfig"->'schema'->'nodes' @> '[{"template": "docker-runtime"}]'
    `);

    // 4. Update graph_revisions.configDiff — JSON Patch ops that reference template paths
    //    Replace string occurrences of "docker-runtime" within the configDiff JSONB
    this.addSql(`
      UPDATE "graph_revisions"
      SET "configDiff" = regexp_replace(
        "configDiff"::text,
        '"docker-runtime"',
        '"runtime"',
        'g'
      )::jsonb
      WHERE "configDiff" IS NOT NULL
        AND "configDiff"::text LIKE '%docker-runtime%'
    `);
  }

  override async down(): Promise<void> {
    // Reverse: rename 'runtime' back to 'docker-runtime'

    // 1. graphs.schema
    this.addSql(`
      UPDATE "graphs"
      SET "schema" = (
        SELECT jsonb_set(
          "schema",
          '{nodes}',
          (
            SELECT coalesce(jsonb_agg(
              CASE
                WHEN node->>'template' = 'runtime'
                THEN jsonb_set(node, '{template}', '"docker-runtime"')
                ELSE node
              END
              ORDER BY idx
            ), '[]'::jsonb)
            FROM jsonb_array_elements("schema"->'nodes') WITH ORDINALITY AS t(node, idx)
          )
        )
      )
      WHERE "schema"->'nodes' @> '[{"template": "runtime"}]'
    `);

    // 2. graph_revisions.clientConfig
    this.addSql(`
      UPDATE "graph_revisions"
      SET "clientConfig" = jsonb_set(
        "clientConfig",
        '{schema,nodes}',
        (
          SELECT coalesce(jsonb_agg(
            CASE
              WHEN node->>'template' = 'runtime'
              THEN jsonb_set(node, '{template}', '"docker-runtime"')
              ELSE node
            END
            ORDER BY idx
          ), '[]'::jsonb)
          FROM jsonb_array_elements("clientConfig"->'schema'->'nodes') WITH ORDINALITY AS t(node, idx)
        )
      )
      WHERE "clientConfig"->'schema'->'nodes' @> '[{"template": "runtime"}]'
    `);

    // 3. graph_revisions.newConfig
    this.addSql(`
      UPDATE "graph_revisions"
      SET "newConfig" = jsonb_set(
        "newConfig",
        '{schema,nodes}',
        (
          SELECT coalesce(jsonb_agg(
            CASE
              WHEN node->>'template' = 'runtime'
              THEN jsonb_set(node, '{template}', '"docker-runtime"')
              ELSE node
            END
            ORDER BY idx
          ), '[]'::jsonb)
          FROM jsonb_array_elements("newConfig"->'schema'->'nodes') WITH ORDINALITY AS t(node, idx)
        )
      )
      WHERE "newConfig" IS NOT NULL
        AND "newConfig"->'schema'->'nodes' @> '[{"template": "runtime"}]'
    `);

    // 4. graph_revisions.configDiff
    this.addSql(`
      UPDATE "graph_revisions"
      SET "configDiff" = regexp_replace(
        "configDiff"::text,
        '"runtime"',
        '"docker-runtime"',
        'g'
      )::jsonb
      WHERE "configDiff" IS NOT NULL
        AND "configDiff"::text LIKE '%"runtime"%'
    `);
  }
}
