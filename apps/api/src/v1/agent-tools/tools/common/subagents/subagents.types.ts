import { RuntimeThreadProvider } from '../../../../runtime/services/runtime-thread-provider';
import { BuiltAgentTool } from '../../base-tool';

export interface SubagentsToolGroupConfig {
  /** Resource information string appended to subagent system prompts. */
  resourcesInformation?: string;
  /** Pre-built tool sets keyed by SubagentToolId. Populated by the template. */
  toolSets?: Map<string, BuiltAgentTool[]>;
  /** Runtime provider for discovering workspace context (e.g. git repo path). */
  runtimeProvider?: RuntimeThreadProvider;
}
