import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable, Scope } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { KnowledgeDocDao } from '../../../../knowledge/dao/knowledge-doc.dao';
import { KnowledgeChunksService } from '../../../../knowledge/services/knowledge-chunks.service';
import { zodToAjvSchema } from '../../../agent-tools.utils';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

export const KnowledgeSearchChunksSchema = z.object({
  docIds: z.array(z.uuid()).min(1).describe('Document IDs to search within'),
  query: z.string().min(1).describe('Natural language query to search for'),
  topK: z.number().int().min(1).max(20).optional().describe('Max chunks'),
});

export type KnowledgeSearchChunksSchemaType = z.infer<
  typeof KnowledgeSearchChunksSchema
>;

export type KnowledgeSearchChunksResult = {
  chunkId: string;
  chunkPublicId: number;
  docId: string;
  docPublicId: number | null;
  score: number;
  snippet: string;
};

@Injectable({ scope: Scope.TRANSIENT })
export class KnowledgeSearchChunksTool extends BaseTool<
  KnowledgeSearchChunksSchemaType,
  KnowledgeToolGroupConfig
> {
  public name = 'knowledge_search_chunks';
  public description =
    'Search knowledge chunks for specific documents and return snippets.';

  constructor(
    private readonly docDao: KnowledgeDocDao,
    private readonly knowledgeChunksService: KnowledgeChunksService,
  ) {
    super();
  }

  public getDetailedInstructions(
    _config: KnowledgeToolGroupConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Searches knowledge chunks for specific documents using vector search and returns snippets.

      ### When to Use
      After you have identified relevant document IDs and need the best chunk snippets.

      ### Best Practices
      Keep docIds focused. Use a concise query and keep topK small (3-7).

      ### Examples
      \`\`\`json
      {"docIds": ["2b0c3f5a-1f2c-4c2d-9c33-1ad9c1c1a123"], "query": "rate limits", "topK": 5}
      \`\`\`
    `;
  }

  public get schema() {
    return zodToAjvSchema(KnowledgeSearchChunksSchema);
  }

  public async invoke(
    args: KnowledgeSearchChunksSchemaType,
    config: KnowledgeToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<KnowledgeSearchChunksResult[]>> {
    const graphCreatedBy = runnableConfig.configurable?.graph_created_by;
    if (!graphCreatedBy) {
      throw new BadRequestException(undefined, 'graph_created_by is required');
    }

    const normalizedQuery = args.query.trim();
    if (!normalizedQuery) {
      throw new BadRequestException('QUERY_REQUIRED');
    }

    const tagsFilter = this.normalizeTags(config.tags);
    const docs = await this.docDao.getAll({
      createdBy: graphCreatedBy,
      ids: args.docIds,
      tags: tagsFilter,
      projection: ['id', 'publicId'],
      order: { updatedAt: 'DESC' },
    });

    if (docs.length === 0) {
      return { output: [] };
    }

    const docIds = docs.map((doc) => doc.id);
    const docPublicIdById = new Map(
      docs.map((doc) => [doc.id, doc.publicId] as const),
    );

    const topK = args.topK ?? 5;
    const chunks = await this.knowledgeChunksService.searchChunks({
      docIds,
      query: normalizedQuery,
      topK,
    });

    const output = chunks.map((chunk) => ({
      chunkId: chunk.id,
      chunkPublicId: chunk.publicId,
      docId: chunk.docId,
      docPublicId: docPublicIdById.get(chunk.docId) ?? null,
      score: chunk.score,
      snippet: chunk.snippet,
    }));

    const title = this.generateTitle?.(args, config);

    return {
      output,
      messageMetadata: {
        __title: title,
      },
    };
  }

  protected override generateTitle(
    args: KnowledgeSearchChunksSchemaType,
    _config: KnowledgeToolGroupConfig,
  ): string {
    return `Knowledge chunk search: ${args.query}`;
  }

  private normalizeTags(tags?: string[]): string[] | undefined {
    const merged = new Set<string>();
    for (const tag of tags ?? []) {
      const normalized = tag.trim().toLowerCase();
      if (normalized) merged.add(normalized);
    }
    return merged.size ? Array.from(merged) : undefined;
  }
}
