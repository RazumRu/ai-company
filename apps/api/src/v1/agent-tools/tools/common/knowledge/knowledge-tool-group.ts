import { Injectable } from '@nestjs/common';

import {
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
} from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { KnowledgeGetChunksTool } from './knowledge-get-chunks.tool';
import { KnowledgeSearchChunksTool } from './knowledge-search-chunks.tool';
import { KnowledgeSearchDocsTool } from './knowledge-search-docs.tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

@Injectable()
export class KnowledgeToolGroup extends BaseToolGroup<KnowledgeToolGroupConfig> {
  constructor(
    private readonly knowledgeSearchDocsTool: KnowledgeSearchDocsTool,
    private readonly knowledgeSearchChunksTool: KnowledgeSearchChunksTool,
    private readonly knowledgeGetChunksTool: KnowledgeGetChunksTool,
  ) {
    super();
  }

  protected buildToolsInternal(
    config: KnowledgeToolGroupConfig,
    lgConfig?: ExtendedLangGraphRunnableConfig,
  ): BuiltAgentTool[] {
    return [
      this.knowledgeSearchDocsTool.build(config, lgConfig),
      this.knowledgeSearchChunksTool.build(config, lgConfig),
      this.knowledgeGetChunksTool.build(config, lgConfig),
    ];
  }
}
