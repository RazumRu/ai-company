import { Injectable } from '@nestjs/common';

import {
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
} from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { KnowledgeGetChunksTool } from './knowledge-get-chunks.tool';
import { KnowledgeSearchTool } from './knowledge-search.tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

@Injectable()
export class KnowledgeToolGroup extends BaseToolGroup<KnowledgeToolGroupConfig> {
  constructor(
    private readonly knowledgeSearchTool: KnowledgeSearchTool,
    private readonly knowledgeGetChunksTool: KnowledgeGetChunksTool,
  ) {
    super();
  }

  protected buildToolsInternal(
    config: KnowledgeToolGroupConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): BuiltAgentTool[] {
    return [
      this.knowledgeSearchTool.build(config, lgConfig),
      this.knowledgeGetChunksTool.build(config, lgConfig),
    ];
  }
}
