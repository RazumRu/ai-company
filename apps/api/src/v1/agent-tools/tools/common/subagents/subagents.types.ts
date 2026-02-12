import { BuiltAgentTool } from '../../base-tool';

export interface SubagentsToolGroupConfig {
  /** Resource information string appended to subagent system prompts. */
  resourcesInformation?: string;
  /** Override model for "smart" intelligence. */
  smartModelOverride?: string;
  /** Pre-built tool sets keyed by SubagentToolId. Populated by the template. */
  toolSets?: Map<string, BuiltAgentTool[]>;
}
