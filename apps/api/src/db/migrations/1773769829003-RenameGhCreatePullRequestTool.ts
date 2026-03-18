import { MigrationInterface, QueryRunner } from 'typeorm';

const OLD_TOOL_NAME = 'gh_create_pull_request';
const NEW_TOOL_NAME = 'gh_pr_create';

const OLD_TOOL_TYPE = 'create_pull_request';
const NEW_TOOL_TYPE = 'pr_create';

/**
 * Renames the GitHub "create pull request" tool from `gh_create_pull_request`
 * to `gh_pr_create` across all persisted data:
 *
 * - messages.name (varchar) — tool result messages
 * - messages.toolCallNames (text[]) — AI messages that invoked the tool
 * - messages.answeredToolCallNames (text[]) — tool result message metadata
 * - messages.message (jsonb) — full message payload (toolCalls[].name, top-level name)
 * - graphs.schema (jsonb) — node configs that may reference the tool type enum value
 * - graph_revisions.clientConfig / newConfig (jsonb) — revision snapshots
 */
export class RenameGhCreatePullRequestTool1773769829003 implements MigrationInterface {
  name = 'RenameGhCreatePullRequestTool1773769829003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. messages.name — tool result messages with the old tool name
    await queryRunner.query(
      `UPDATE "messages" SET "name" = $1 WHERE "name" = $2`,
      [NEW_TOOL_NAME, OLD_TOOL_NAME],
    );

    // 2. messages.toolCallNames — replace old name in the text[] array
    await queryRunner.query(
      `UPDATE "messages"
       SET "toolCallNames" = array_replace("toolCallNames", $2, $1)
       WHERE $2 = ANY("toolCallNames")`,
      [NEW_TOOL_NAME, OLD_TOOL_NAME],
    );

    // 3. messages.answeredToolCallNames — replace old name in the text[] array
    await queryRunner.query(
      `UPDATE "messages"
       SET "answeredToolCallNames" = array_replace("answeredToolCallNames", $2, $1)
       WHERE $2 = ANY("answeredToolCallNames")`,
      [NEW_TOOL_NAME, OLD_TOOL_NAME],
    );

    // 4. messages.message (jsonb) — rename toolCalls[].name and top-level name
    //    Uses jsonb_set with a subquery to rebuild the toolCalls array.
    await queryRunner.query(
      `UPDATE "messages"
       SET "message" = jsonb_set(
         "message",
         '{name}',
         to_jsonb($1::text)
       )
       WHERE "message"->>'name' = $2`,
      [NEW_TOOL_NAME, OLD_TOOL_NAME],
    );

    await queryRunner.query(
      `UPDATE "messages"
       SET "message" = jsonb_set(
         "message",
         '{toolCalls}',
         (
           SELECT coalesce(jsonb_agg(
             CASE
               WHEN tc->>'name' = $2
               THEN jsonb_set(tc, '{name}', to_jsonb($1::text))
               ELSE tc
             END
             ORDER BY idx
           ), '[]'::jsonb)
           FROM jsonb_array_elements("message"->'toolCalls') WITH ORDINALITY AS t(tc, idx)
         )
       )
       WHERE "message"->'toolCalls' IS NOT NULL
         AND "message"::text LIKE '%' || $2 || '%'`,
      [NEW_TOOL_NAME, OLD_TOOL_NAME],
    );

    // 5. graphs.schema — replace tool type in node configs
    //    The schema is { nodes: [{ config: { ... } }] }. Tool type values
    //    like "create_pull_request" may appear anywhere in the config JSONB.
    await queryRunner.query(
      `UPDATE "graphs"
       SET "schema" = replace("schema"::text, $2, $1)::jsonb
       WHERE "schema"::text LIKE '%' || $2 || '%'`,
      [NEW_TOOL_TYPE, OLD_TOOL_TYPE],
    );

    // 6. graph_revisions.clientConfig and newConfig — same replacement
    await queryRunner.query(
      `UPDATE "graph_revisions"
       SET "clientConfig" = replace("clientConfig"::text, $2, $1)::jsonb
       WHERE "clientConfig"::text LIKE '%' || $2 || '%'`,
      [NEW_TOOL_TYPE, OLD_TOOL_TYPE],
    );

    await queryRunner.query(
      `UPDATE "graph_revisions"
       SET "newConfig" = replace("newConfig"::text, $2, $1)::jsonb
       WHERE "newConfig"::text LIKE '%' || $2 || '%'`,
      [NEW_TOOL_TYPE, OLD_TOOL_TYPE],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse: rename back from new to old

    // 1. messages.name
    await queryRunner.query(
      `UPDATE "messages" SET "name" = $1 WHERE "name" = $2`,
      [OLD_TOOL_NAME, NEW_TOOL_NAME],
    );

    // 2. messages.toolCallNames
    await queryRunner.query(
      `UPDATE "messages"
       SET "toolCallNames" = array_replace("toolCallNames", $2, $1)
       WHERE $2 = ANY("toolCallNames")`,
      [OLD_TOOL_NAME, NEW_TOOL_NAME],
    );

    // 3. messages.answeredToolCallNames
    await queryRunner.query(
      `UPDATE "messages"
       SET "answeredToolCallNames" = array_replace("answeredToolCallNames", $2, $1)
       WHERE $2 = ANY("answeredToolCallNames")`,
      [OLD_TOOL_NAME, NEW_TOOL_NAME],
    );

    // 4. messages.message (jsonb) — top-level name
    await queryRunner.query(
      `UPDATE "messages"
       SET "message" = jsonb_set(
         "message",
         '{name}',
         to_jsonb($1::text)
       )
       WHERE "message"->>'name' = $2`,
      [OLD_TOOL_NAME, NEW_TOOL_NAME],
    );

    // 4b. messages.message (jsonb) — toolCalls[].name
    await queryRunner.query(
      `UPDATE "messages"
       SET "message" = jsonb_set(
         "message",
         '{toolCalls}',
         (
           SELECT coalesce(jsonb_agg(
             CASE
               WHEN tc->>'name' = $2
               THEN jsonb_set(tc, '{name}', to_jsonb($1::text))
               ELSE tc
             END
             ORDER BY idx
           ), '[]'::jsonb)
           FROM jsonb_array_elements("message"->'toolCalls') WITH ORDINALITY AS t(tc, idx)
         )
       )
       WHERE "message"->'toolCalls' IS NOT NULL
         AND "message"::text LIKE '%' || $2 || '%'`,
      [OLD_TOOL_NAME, NEW_TOOL_NAME],
    );

    // 5. graphs.schema
    await queryRunner.query(
      `UPDATE "graphs"
       SET "schema" = replace("schema"::text, $2, $1)::jsonb
       WHERE "schema"::text LIKE '%' || $2 || '%'`,
      [OLD_TOOL_TYPE, NEW_TOOL_TYPE],
    );

    // 6. graph_revisions.clientConfig and newConfig
    await queryRunner.query(
      `UPDATE "graph_revisions"
       SET "clientConfig" = replace("clientConfig"::text, $2, $1)::jsonb
       WHERE "clientConfig"::text LIKE '%' || $2 || '%'`,
      [OLD_TOOL_TYPE, NEW_TOOL_TYPE],
    );

    await queryRunner.query(
      `UPDATE "graph_revisions"
       SET "newConfig" = replace("newConfig"::text, $2, $1)::jsonb
       WHERE "newConfig"::text LIKE '%' || $2 || '%'`,
      [OLD_TOOL_TYPE, NEW_TOOL_TYPE],
    );
  }
}
