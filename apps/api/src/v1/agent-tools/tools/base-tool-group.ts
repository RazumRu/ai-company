import { BuiltAgentTool, ExtendedLangGraphRunnableConfig } from './base-tool';

export type ToolGroupBuildResult = {
  tools: BuiltAgentTool[];
  instructions?: string;
};

export abstract class BaseToolGroup<TConfig = unknown> {
  /**
   * Build and return the tools for this group along with optional group-level instructions.
   * Returns an object with:
   * - tools: Array of built tools
   * - instructions: Optional group-level instructions that apply to all tools
   */
  public buildTools(
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): ToolGroupBuildResult {
    const tools = this.buildToolsInternal(config, lgConfig);
    const instructions = this.getDetailedInstructions?.(config, lgConfig);

    return {
      tools,
      instructions,
    };
  }

  /**
   * Build and return the array of tools for this group.
   * Subclasses should implement this to construct their specific tools.
   */
  protected abstract buildToolsInternal(
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): BuiltAgentTool[];

  /**
   * Optional method to provide group-level instructions that apply to all tools in this group.
   * These instructions will be collected by the agent template and injected into the system prompt.
   */
  public getDetailedInstructions?(
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string;
}
