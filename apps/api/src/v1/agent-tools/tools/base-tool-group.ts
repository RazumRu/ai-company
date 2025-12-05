import { BuiltAgentTool, ExtendedLangGraphRunnableConfig } from './base-tool';

export abstract class BaseToolGroup<TConfig = unknown> {
  public abstract buildTools(
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): BuiltAgentTool[];
}
