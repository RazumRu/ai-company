import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable, Scope } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { KnowledgeDocDao } from '../../../../knowledge/dao/knowledge-doc.dao';
import { KnowledgeChunksService } from '../../../../knowledge/services/knowledge-chunks.service';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

export const KnowledgeSearchChunksSchema = z.object({
  docIds: z
    .array(z.number().int().positive())
    .min(1)
    .describe(
      'Document public IDs to search within (obtained from knowledge_search_docs results). Keep this focused — searching fewer documents yields more relevant results.',
    ),
  query: z
    .string()
    .min(1)
    .describe(
      'Natural-language query describing what information you need (e.g., "rate limit configuration", "database migration process"). Semantic search — phrasing matters.',
    ),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe(
      'Maximum number of chunk snippets to return (default: 5, max: 20). Start with 3-7 for focused queries.',
    ),
});

export type KnowledgeSearchChunksSchemaType = z.infer<
  typeof KnowledgeSearchChunksSchema
>;

export type KnowledgeSearchChunksResult = {
  chunkPublicId: number;
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
    'Search within specific knowledge documents using vector similarity and return the most relevant content snippets. Requires document public IDs from knowledge_search_docs. Returns chunk snippets with scores and chunk IDs that can be used with knowledge_get_chunks to retrieve full chunk text. Use this when you need to find specific information within known documents rather than reading entire documents.';

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
      Keep docIds focused. Use document public IDs from knowledge_search_docs. Use a concise query and keep topK small (3-7).

      ### Examples
      \`\`\`json
      {"docIds": [101], "query": "rate limits", "topK": 5}
      \`\`\`
    `;
  }

  public get schema() {
    return KnowledgeSearchChunksSchema;
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
      publicIds: args.docIds,
      tags: tagsFilter,
      projection: ['id', 'publicId'],
      order: { updatedAt: 'DESC' },
    });

    if (docs.length === 0) {
      return { output: [] };
    }

    const resolvedDocIds = docs.map((doc) => doc.id);
    const docPublicIdById = new Map(
      docs.map((doc) => [doc.id, doc.publicId] as const),
    );

    const topK = args.topK ?? 5;
    const chunks = await this.knowledgeChunksService.searchChunks({
      docIds: resolvedDocIds,
      query: normalizedQuery,
      topK,
    });

    const output = chunks.map((chunk) => ({
      chunkPublicId: chunk.publicId,
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
