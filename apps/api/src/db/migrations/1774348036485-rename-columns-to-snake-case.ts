import { Migration } from '@mikro-orm/migrations';

export class RenameColumnsToSnakeCase1774348036485 extends Migration {
  override async up(): Promise<void> {
    // graph_checkpoints
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "threadId" TO "thread_id"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "parentThreadId" TO "parent_thread_id"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "nodeId" TO "node_id"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "checkpointNs" TO "checkpoint_ns"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "checkpointId" TO "checkpoint_id"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "parentCheckpointId" TO "parent_checkpoint_id"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );

    // graph_checkpoint_writes
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "threadId" TO "thread_id"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "checkpointNs" TO "checkpoint_ns"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "checkpointId" TO "checkpoint_id"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "taskId" TO "task_id"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );

    // graphs
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "targetVersion" TO "target_version"`,
    );
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "createdBy" TO "created_by"`,
    );
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "projectId" TO "project_id"`,
    );

    // graph_revisions
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "graphId" TO "graph_id"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "baseVersion" TO "base_version"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "toVersion" TO "to_version"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "configDiff" TO "config_diff"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "clientConfig" TO "client_config"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "newConfig" TO "new_config"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "createdBy" TO "created_by"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );

    // threads
    this.addSql(`ALTER TABLE "threads" RENAME COLUMN "graphId" TO "graph_id"`);
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "externalThreadId" TO "external_thread_id"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "lastRunId" TO "last_run_id"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "createdBy" TO "created_by"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "projectId" TO "project_id"`,
    );

    // messages
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "threadId" TO "thread_id"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "externalThreadId" TO "external_thread_id"`,
    );
    this.addSql(`ALTER TABLE "messages" RENAME COLUMN "nodeId" TO "node_id"`);
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "requestTokenUsage" TO "request_token_usage"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "toolCallNames" TO "tool_call_names"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "answeredToolCallNames" TO "answered_tool_call_names"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "toolCallIds" TO "tool_call_ids"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "additionalKwargs" TO "additional_kwargs"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "toolTokenUsage" TO "tool_token_usage"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );

    // projects
    this.addSql(
      `ALTER TABLE "projects" RENAME COLUMN "createdBy" TO "created_by"`,
    );
    this.addSql(
      `ALTER TABLE "projects" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "projects" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "projects" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );

    // runtime_instances
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "graphId" TO "graph_id"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "nodeId" TO "node_id"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "threadId" TO "thread_id"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "containerName" TO "container_name"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "lastUsedAt" TO "last_used_at"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );

    // git_repositories
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "createdBy" TO "created_by"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "projectId" TO "project_id"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "defaultBranch" TO "default_branch"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "installationId" TO "installation_id"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "syncedAt" TO "synced_at"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );

    // repo_indexes
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "repositoryId" TO "repository_id"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "repoUrl" TO "repo_url"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "qdrantCollection" TO "qdrant_collection"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "lastIndexedCommit" TO "last_indexed_commit"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "embeddingModel" TO "embedding_model"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "vectorSize" TO "vector_size"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "chunkingSignatureHash" TO "chunking_signature_hash"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "estimatedTokens" TO "estimated_tokens"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "indexedTokens" TO "indexed_tokens"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "errorMessage" TO "error_message"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );

    // git_provider_connections
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "userId" TO "user_id"`,
    );
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "accountLogin" TO "account_login"`,
    );
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "isActive" TO "is_active"`,
    );
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );

    // knowledge_docs
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "publicId" TO "public_id"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "embeddingModel" TO "embedding_model"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "createdBy" TO "created_by"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "projectId" TO "project_id"`,
    );

    // user_preference
    this.addSql(
      `ALTER TABLE "user_preference" RENAME COLUMN "userId" TO "user_id"`,
    );
    this.addSql(
      `ALTER TABLE "user_preference" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "user_preference" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );

    // webhook_processed_event
    this.addSql(
      `ALTER TABLE "webhook_processed_event" RENAME COLUMN "dedupKey" TO "dedup_key"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_processed_event" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_processed_event" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_processed_event" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );

    // webhook_sync_state
    this.addSql(
      `ALTER TABLE "webhook_sync_state" RENAME COLUMN "lastSyncDate" TO "last_sync_date"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_sync_state" RENAME COLUMN "createdAt" TO "created_at"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_sync_state" RENAME COLUMN "updatedAt" TO "updated_at"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_sync_state" RENAME COLUMN "deletedAt" TO "deleted_at"`,
    );

    // Create MikroORM migration tracking table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS "mikro_orm_migrations" (
        "id" serial PRIMARY KEY,
        "name" varchar(255) NOT NULL,
        "executed_at" timestamptz DEFAULT current_timestamp
      )
    `);

    // Seed all existing migrations as already executed
    this.addSql(`
      INSERT INTO "mikro_orm_migrations" ("name") VALUES
        ('Generated1759225623237'),
        ('Generated1760033572363'),
        ('Generated1760469127376'),
        ('Generated1761421907836'),
        ('Generated1761511170801'),
        ('Generated1761684645739'),
        ('AddNameToThreads1761773225903'),
        ('Generated1762201441417'),
        ('Generated1762375281897'),
        ('Generated1762461785810'),
        ('Generated1762944001280'),
        ('Generated1762963411077'),
        ('Generated1762965279079'),
        ('ReplaceSchemaSnapshotWithClientSchema1762965300000'),
        ('Generated1765639738210'),
        ('Generated1765733379573'),
        ('DropThreadsTokenUsage1765819750059'),
        ('AddTokenUsageToThreads1765913470902'),
        ('GraphRevisionConfig1767026178813'),
        ('AddParentThreadIdToGraphCheckpoints1768196540296'),
        ('MigrateRequestUsageToTokenUsage1768196540297'),
        ('AddRoleAndNameToMessages1768197069212'),
        ('RemoveTokenUsageFromThreads1768197069213'),
        ('RenameTokenUsageToRequestTokenUsage1768204500000'),
        ('Generated1768206581388'),
        ('AddToolCallNamesToMessages1768209000000'),
        ('Generated1768304680258'),
        ('AddNodeIdToGraphCheckpoints1768304680259'),
        ('Generated1768473238699'),
        ('Generated1768490525659'),
        ('Generated1768900167833'),
        ('Generated1768926638724'),
        ('Generated1769074243480'),
        ('Generated1769256218260'),
        ('Generated1769768360858'),
        ('Generated1770117238302'),
        ('Generated1770209370585'),
        ('Generated1770280518340'),
        ('Generated1770374821534'),
        ('Generated1770380919707'),
        ('Generated1770623800249'),
        ('Generated1770637053549'),
        ('Generated1770793814179'),
        ('Generated1771227444598'),
        ('Generated1771232334756'),
        ('Generated1771688261812'),
        ('AddDaytonaRuntimeType1771700000000'),
        ('RenameDockRuntimeToRuntime1771700000001'),
        ('AddFailedRuntimeInstanceStatus1771700000002'),
        ('AddProjectsFeature1772088372277'),
        ('Generated1772179609633'),
        ('Generated1772184988783'),
        ('AddGraphAgentsColumn1772538380484'),
        ('Generated1772723656606'),
        ('Generated1772727311658'),
        ('MakeRuntimeInstanceGraphIdNullable1772732040404'),
        ('GitAuthRename1772795852407'),
        ('GitRepositoryNullableProjectId1772856000000'),
        ('Generated1773078280965'),
        ('RenameGhCreatePullRequestTool1773769829003'),
        ('Generated1774281863983'),
        ('Generated1774335741918'),
        ('Generated1774348036484'),
        ('RenameColumnsToSnakeCase1774348036485')
    `);
  }

  override async down(): Promise<void> {
    // webhook_sync_state
    this.addSql(
      `ALTER TABLE "webhook_sync_state" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_sync_state" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_sync_state" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_sync_state" RENAME COLUMN "last_sync_date" TO "lastSyncDate"`,
    );

    // webhook_processed_event
    this.addSql(
      `ALTER TABLE "webhook_processed_event" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_processed_event" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_processed_event" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "webhook_processed_event" RENAME COLUMN "dedup_key" TO "dedupKey"`,
    );

    // user_preference
    this.addSql(
      `ALTER TABLE "user_preference" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "user_preference" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "user_preference" RENAME COLUMN "user_id" TO "userId"`,
    );

    // knowledge_docs
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "project_id" TO "projectId"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "created_by" TO "createdBy"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "embedding_model" TO "embeddingModel"`,
    );
    this.addSql(
      `ALTER TABLE "knowledge_docs" RENAME COLUMN "public_id" TO "publicId"`,
    );

    // git_provider_connections
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "is_active" TO "isActive"`,
    );
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "account_login" TO "accountLogin"`,
    );
    this.addSql(
      `ALTER TABLE "git_provider_connections" RENAME COLUMN "user_id" TO "userId"`,
    );

    // repo_indexes
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "error_message" TO "errorMessage"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "indexed_tokens" TO "indexedTokens"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "estimated_tokens" TO "estimatedTokens"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "chunking_signature_hash" TO "chunkingSignatureHash"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "vector_size" TO "vectorSize"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "embedding_model" TO "embeddingModel"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "last_indexed_commit" TO "lastIndexedCommit"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "qdrant_collection" TO "qdrantCollection"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "repo_url" TO "repoUrl"`,
    );
    this.addSql(
      `ALTER TABLE "repo_indexes" RENAME COLUMN "repository_id" TO "repositoryId"`,
    );

    // git_repositories
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "synced_at" TO "syncedAt"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "installation_id" TO "installationId"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "default_branch" TO "defaultBranch"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "project_id" TO "projectId"`,
    );
    this.addSql(
      `ALTER TABLE "git_repositories" RENAME COLUMN "created_by" TO "createdBy"`,
    );

    // runtime_instances
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "last_used_at" TO "lastUsedAt"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "container_name" TO "containerName"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "thread_id" TO "threadId"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "node_id" TO "nodeId"`,
    );
    this.addSql(
      `ALTER TABLE "runtime_instances" RENAME COLUMN "graph_id" TO "graphId"`,
    );

    // projects
    this.addSql(
      `ALTER TABLE "projects" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "projects" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "projects" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "projects" RENAME COLUMN "created_by" TO "createdBy"`,
    );

    // messages
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "tool_token_usage" TO "toolTokenUsage"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "additional_kwargs" TO "additionalKwargs"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "tool_call_ids" TO "toolCallIds"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "answered_tool_call_names" TO "answeredToolCallNames"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "tool_call_names" TO "toolCallNames"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "request_token_usage" TO "requestTokenUsage"`,
    );
    this.addSql(`ALTER TABLE "messages" RENAME COLUMN "node_id" TO "nodeId"`);
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "external_thread_id" TO "externalThreadId"`,
    );
    this.addSql(
      `ALTER TABLE "messages" RENAME COLUMN "thread_id" TO "threadId"`,
    );

    // threads
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "project_id" TO "projectId"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "created_by" TO "createdBy"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "last_run_id" TO "lastRunId"`,
    );
    this.addSql(
      `ALTER TABLE "threads" RENAME COLUMN "external_thread_id" TO "externalThreadId"`,
    );
    this.addSql(`ALTER TABLE "threads" RENAME COLUMN "graph_id" TO "graphId"`);

    // graph_revisions
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "created_by" TO "createdBy"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "new_config" TO "newConfig"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "client_config" TO "clientConfig"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "config_diff" TO "configDiff"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "to_version" TO "toVersion"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "base_version" TO "baseVersion"`,
    );
    this.addSql(
      `ALTER TABLE "graph_revisions" RENAME COLUMN "graph_id" TO "graphId"`,
    );

    // graphs
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "project_id" TO "projectId"`,
    );
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "created_by" TO "createdBy"`,
    );
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "deleted_at" TO "deletedAt"`,
    );
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "graphs" RENAME COLUMN "target_version" TO "targetVersion"`,
    );

    // graph_checkpoint_writes
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "task_id" TO "taskId"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "checkpoint_id" TO "checkpointId"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "checkpoint_ns" TO "checkpointNs"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoint_writes" RENAME COLUMN "thread_id" TO "threadId"`,
    );

    // graph_checkpoints
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "updated_at" TO "updatedAt"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "created_at" TO "createdAt"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "parent_checkpoint_id" TO "parentCheckpointId"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "checkpoint_id" TO "checkpointId"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "checkpoint_ns" TO "checkpointNs"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "node_id" TO "nodeId"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "parent_thread_id" TO "parentThreadId"`,
    );
    this.addSql(
      `ALTER TABLE "graph_checkpoints" RENAME COLUMN "thread_id" TO "threadId"`,
    );

    // Drop MikroORM migration tracking table
    this.addSql(`DROP TABLE IF EXISTS "mikro_orm_migrations"`);
  }
}
