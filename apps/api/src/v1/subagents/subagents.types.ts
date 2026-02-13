import { LlmModelsService } from '../litellm/services/llm-models.service';

/** Logical tool set identifiers available to subagent definitions. */
export enum SubagentToolId {
  /** Full shell access. */
  Shell = 'shell',
  /** Shell with read-only access (enforced via system prompt). */
  ShellReadOnly = 'shell:read-only',
  /** File tools without edit/write/delete. */
  FilesReadOnly = 'files:read-only',
  /** File tools with all actions. */
  FilesFull = 'files:full',
}

/** Context passed to the model resolver callback at runtime. */
export interface SubagentModelContext {
  /** The model name used by the parent agent. */
  parentModel: string;
  /** Service for resolving model names with offline fallback logic. */
  llmModelsService: LlmModelsService;
}

/** Context passed to the systemPrompt builder at runtime. */
export interface SubagentPromptContext {
  /** Absolute path to the currently cloned git repository, if discovered. */
  gitRepoPath?: string;
  /** Additional resource/environment information from the parent agent. */
  resourcesInformation?: string;
}

export interface SubagentDefinition {
  /** Unique identifier for this subagent (e.g. 'explorer', 'simple'). */
  id: string;
  /** Human-readable description shown to the parent LLM when listing agents. */
  description: string;
  /** Builds the system prompt at runtime, receiving workspace context (git repo path, resources info). */
  systemPrompt: (ctx: SubagentPromptContext) => string;
  /** Logical tool IDs this subagent has access to. */
  toolIds: SubagentToolId[];
  /** Resolves the model name at runtime. Receives parent agent model and LlmModelsService. */
  model: (ctx: SubagentModelContext) => string;
  /** Maximum LLM iterations before the subagent is force-stopped. */
  maxIterations: number;
  /** Max context window tokens. Omit for no limit. */
  maxContextTokens?: number;
}
