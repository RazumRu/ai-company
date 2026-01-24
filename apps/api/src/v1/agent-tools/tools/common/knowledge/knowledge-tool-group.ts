import { Injectable } from '@nestjs/common';

import {
  BuiltAgentTool,
  ExtendedLangGraphRunnableConfig,
} from '../../base-tool';
import { BaseToolGroup } from '../../base-tool-group';
import { KnowledgeGetChunksTool } from './knowledge-get-chunks.tool';
import { KnowledgeGetDocTool } from './knowledge-get-doc.tool';
import { KnowledgeSearchChunksTool } from './knowledge-search-chunks.tool';
import { KnowledgeSearchDocsTool } from './knowledge-search-docs.tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

@Injectable()
export class KnowledgeToolGroup extends BaseToolGroup<KnowledgeToolGroupConfig> {
  constructor(
    private readonly knowledgeSearchDocsTool: KnowledgeSearchDocsTool,
    private readonly knowledgeSearchChunksTool: KnowledgeSearchChunksTool,
    private readonly knowledgeGetChunksTool: KnowledgeGetChunksTool,
    private readonly knowledgeGetDocTool: KnowledgeGetDocTool,
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
      this.knowledgeGetDocTool.build(config, lgConfig),
    ];
  }

  public getDetailedInstructions(): string {
    return [
      'Before starting non-trivial work, consider using the knowledge tools to gather necessary context.',
      'Skip this for small/simple tasks (e.g., "show me file content") when no additional context is needed.',
      'Process:',
      '1) If you need project context, use knowledge_search_docs to find relevant documents for the current task.',
      '   - When calling the tool inside a task input, specify the current project stack and technologies in the query.',
      '   - If no documents are returned, read the comment for guidance and refine the query.',
      '   - You may rerun knowledge_search_docs with a different query if it could surface relevant documents.',
      '   - If you had to identify the repo stack/technologies or structure first, rerun knowledge_search_docs before implementation using the refined context.',
      '   - Always check the policy for every returned document and treat it as requirements for whether to return the document and how to use it.',
      '   - Example: if the policy says the document must be returned in all cases, always return it.',
      '2) Use knowledge_search_chunks to narrow to the specific relevant sections.',
      '   - You may run knowledge_search_chunks multiple times with different queries to cover the task thoroughly.',
      '3) Use knowledge_get_chunks to read the exact chunks you will rely on.',
      '4) Use knowledge_get_doc only when the document politic instructs you to fetch full content.',
      '   - Example: "If this document is relevant to the current task - always fetch the full content instead of fetching only specific chunks."',
      'Example flow: knowledge_search_docs returns empty -> inspect project files/structure to learn stack -> rephrase the query -> run knowledge_search_docs again to locate docs.',
      'Then write a short note describing how you searched (queries/filters/tags) and what you found.',
    ].join('\n');
  }
}
