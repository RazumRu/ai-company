import { Migration } from '@mikro-orm/migrations';

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
export class RenameGhCreatePullRequestTool1773769829003 extends Migration {
  override async up(): Promise<void> {
    // 1. messages.name — tool result messages with the old tool name
    this.addSql(
      `UPDATE "messages" SET "name" = '${NEW_TOOL_NAME}' WHERE "name" = '${OLD_TOOL_NAME}'`,
    );

    // 2. messages.toolCallNames — replace old name in the text[] array
    this.addSql(
      `UPDATE "messages"
       SET "toolCallNames" = array_replace("toolCallNames", '${OLD_TOOL_NAME}', '${NEW_TOOL_NAME}')
       WHERE '${OLD_TOOL_NAME}' = ANY("toolCallNames")`,
    );

    // 3. messages.answeredToolCallNames — replace old name in the text[] array
    this.addSql(
      `UPDATE "messages"
       SET "answeredToolCallNames" = array_replace("answeredToolCallNames", '${OLD_TOOL_NAME}', '${NEW_TOOL_NAME}')
       WHERE '${OLD_TOOL_NAME}' = ANY("answeredToolCallNames")`,
    );

    // 4. messages.message (jsonb) — rename toolCalls[].name and top-level name
    this.addSql(
      `UPDATE "messages"
       SET "message" = jsonb_set(
         "message",
         '{name}',
         to_jsonb('${NEW_TOOL_NAME}'::text)
       )
       WHERE "message"->>'name' = '${OLD_TOOL_NAME}'`,
    );

    this.addSql(
      `UPDATE "messages"
       SET "message" = jsonb_set(
         "message",
         '{toolCalls}',
         (
           SELECT coalesce(jsonb_agg(
             CASE
               WHEN tc->>'name' = '${OLD_TOOL_NAME}'
               THEN jsonb_set(tc, '{name}', to_jsonb('${NEW_TOOL_NAME}'::text))
               ELSE tc
             END
             ORDER BY idx
           ), '[]'::jsonb)
           FROM jsonb_array_elements("message"->'toolCalls') WITH ORDINALITY AS t(tc, idx)
         )
       )
       WHERE "message"->'toolCalls' IS NOT NULL
         AND "message"::text LIKE '%${OLD_TOOL_NAME}%'`,
    );

    // 5. graphs.schema — replace tool type in node configs
    this.addSql(
      `UPDATE "graphs"
       SET "schema" = replace("schema"::text, '${OLD_TOOL_TYPE}', '${NEW_TOOL_TYPE}')::jsonb
       WHERE "schema"::text LIKE '%${OLD_TOOL_TYPE}%'`,
    );

    // 6. graph_revisions.clientConfig and newConfig — same replacement
    this.addSql(
      `UPDATE "graph_revisions"
       SET "clientConfig" = replace("clientConfig"::text, '${OLD_TOOL_TYPE}', '${NEW_TOOL_TYPE}')::jsonb
       WHERE "clientConfig"::text LIKE '%${OLD_TOOL_TYPE}%'`,
    );

    this.addSql(
      `UPDATE "graph_revisions"
       SET "newConfig" = replace("newConfig"::text, '${OLD_TOOL_TYPE}', '${NEW_TOOL_TYPE}')::jsonb
       WHERE "newConfig"::text LIKE '%${OLD_TOOL_TYPE}%'`,
    );
  }

  override async down(): Promise<void> {
    // Reverse: rename back from new to old

    // 1. messages.name
    this.addSql(
      `UPDATE "messages" SET "name" = '${OLD_TOOL_NAME}' WHERE "name" = '${NEW_TOOL_NAME}'`,
    );

    // 2. messages.toolCallNames
    this.addSql(
      `UPDATE "messages"
       SET "toolCallNames" = array_replace("toolCallNames", '${NEW_TOOL_NAME}', '${OLD_TOOL_NAME}')
       WHERE '${NEW_TOOL_NAME}' = ANY("toolCallNames")`,
    );

    // 3. messages.answeredToolCallNames
    this.addSql(
      `UPDATE "messages"
       SET "answeredToolCallNames" = array_replace("answeredToolCallNames", '${NEW_TOOL_NAME}', '${OLD_TOOL_NAME}')
       WHERE '${NEW_TOOL_NAME}' = ANY("answeredToolCallNames")`,
    );

    // 4. messages.message (jsonb) — top-level name
    this.addSql(
      `UPDATE "messages"
       SET "message" = jsonb_set(
         "message",
         '{name}',
         to_jsonb('${OLD_TOOL_NAME}'::text)
       )
       WHERE "message"->>'name' = '${NEW_TOOL_NAME}'`,
    );

    // 4b. messages.message (jsonb) — toolCalls[].name
    this.addSql(
      `UPDATE "messages"
       SET "message" = jsonb_set(
         "message",
         '{toolCalls}',
         (
           SELECT coalesce(jsonb_agg(
             CASE
               WHEN tc->>'name' = '${NEW_TOOL_NAME}'
               THEN jsonb_set(tc, '{name}', to_jsonb('${OLD_TOOL_NAME}'::text))
               ELSE tc
             END
             ORDER BY idx
           ), '[]'::jsonb)
           FROM jsonb_array_elements("message"->'toolCalls') WITH ORDINALITY AS t(tc, idx)
         )
       )
       WHERE "message"->'toolCalls' IS NOT NULL
         AND "message"::text LIKE '%${NEW_TOOL_NAME}%'`,
    );

    // 5. graphs.schema
    this.addSql(
      `UPDATE "graphs"
       SET "schema" = replace("schema"::text, '${NEW_TOOL_TYPE}', '${OLD_TOOL_TYPE}')::jsonb
       WHERE "schema"::text LIKE '%${NEW_TOOL_TYPE}%'`,
    );

    // 6. graph_revisions.clientConfig and newConfig
    this.addSql(
      `UPDATE "graph_revisions"
       SET "clientConfig" = replace("clientConfig"::text, '${NEW_TOOL_TYPE}', '${OLD_TOOL_TYPE}')::jsonb
       WHERE "clientConfig"::text LIKE '%${NEW_TOOL_TYPE}%'`,
    );

    this.addSql(
      `UPDATE "graph_revisions"
       SET "newConfig" = replace("newConfig"::text, '${NEW_TOOL_TYPE}', '${OLD_TOOL_TYPE}')::jsonb
       WHERE "newConfig"::text LIKE '%${NEW_TOOL_TYPE}%'`,
    );
  }
}
