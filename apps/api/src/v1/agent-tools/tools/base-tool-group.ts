import { DynamicStructuredTool } from '@langchain/core/tools';

import { ExtendedLangGraphRunnableConfig } from './base-tool';

export abstract class BaseToolGroup<TConfig = unknown> {
  public abstract buildTools(
    config: TConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): DynamicStructuredTool[];
}
