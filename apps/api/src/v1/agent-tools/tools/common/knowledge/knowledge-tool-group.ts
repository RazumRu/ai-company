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

  public getDetailedInstructions(): string {
    return [
      'Mandatory before starting any work: use the knowledge tools to gather all necessary context.',
      'Process:',
      '1) Use knowledge_search_docs to find relevant documents for the task.',
      '2) Use knowledge_search_chunks to narrow to the specific relevant sections.',
      '   - You may run knowledge_search_chunks multiple times with different queries to cover the task thoroughly.',
      '3) Use knowledge_get_chunks to read the exact chunks you will rely on.',
      'Then write a short note describing how you searched (queries/filters/tags) and what you found.',
    ].join('\n');
  }
}
