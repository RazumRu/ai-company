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

export interface SubagentDefinition {
  /** Unique identifier for this subagent (e.g. 'explorer', 'simple'). */
  id: string;
  /** Human-readable description shown to the parent LLM when listing agents. */
  description: string;
  /** System prompt injected into the subagent conversation. */
  systemPrompt: string;
  /** Logical tool IDs this subagent has access to. */
  toolIds: SubagentToolId[];
}
