import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable, Scope } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { KnowledgeChunkDao } from '../../../../knowledge/dao/knowledge-chunk.dao';
import { KnowledgeDocDao } from '../../../../knowledge/dao/knowledge-doc.dao';
import { LlmModelsService } from '../../../../litellm/services/llm-models.service';
import { OpenaiService } from '../../../../openai/openai.service';
import { zodToAjvSchema } from '../../../agent-tools.utils';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

export const KnowledgeSearchSchema = z.object({
  query: z.string().min(1).describe('Natural language query to search for'),
  tags: z
    .array(z.string().min(1))
    .optional()
    .describe('Optional tags filter (match any)'),
  topK: z.number().int().min(1).max(20).optional().describe('Top results'),
});

export type KnowledgeSearchSchemaType = z.infer<typeof KnowledgeSearchSchema>;

export type KnowledgeSearchResult = {
  documentTitle: string;
  documentId: string;
  tags: string[];
  chunks: { chunkId: string; text: string; score: number }[];
};

@Injectable({ scope: Scope.TRANSIENT })
export class KnowledgeSearchTool extends BaseTool<
  KnowledgeSearchSchemaType,
  KnowledgeToolGroupConfig
> {
  public name = 'knowledge_search';
  public description =
    'Search the knowledge base for relevant document chunks.';

  constructor(
    private readonly docDao: KnowledgeDocDao,
    private readonly chunkDao: KnowledgeChunkDao,
    private readonly openaiService: OpenaiService,
    private readonly llmModelsService: LlmModelsService,
  ) {
    super();
  }

  public getDetailedInstructions(
    _config: KnowledgeToolGroupConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Searches internal knowledge documents using embeddings and returns the most relevant chunks.

      ### When to Use
      Use this tool to fetch relevant internal guidelines, runbooks, decisions, or snippets before starting work.

      ### When NOT to Use
      For exact file contents → use file tools. For external info → use web_search.

      ### Best Practices
      Use concise queries with key terms. Add tags when you need a strict filter. Keep topK small (3-7) unless you need breadth.

      ### Examples
      **1. Basic search:**
      \`\`\`json
      {"query": "database migration checklist"}
      \`\`\`

      **2. Tag-filtered search:**
      \`\`\`json
      {"query": "error budgets", "tags": ["sre", "policy"], "topK": 5}
      \`\`\`
    `;
  }

  public get schema() {
    return zodToAjvSchema(KnowledgeSearchSchema);
  }

  public async invoke(
    args: KnowledgeSearchSchemaType,
    config: KnowledgeToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<KnowledgeSearchResult[]>> {
    const graphCreatedBy = runnableConfig.configurable?.graph_created_by;
    if (!graphCreatedBy) {
      throw new BadRequestException(undefined, 'graph_created_by is required');
    }

    const normalizedQuery = args.query.trim();
    if (!normalizedQuery) {
      throw new BadRequestException('QUERY_REQUIRED');
    }

    const tagsFilter = this.normalizeTags(args.tags, config.tags);

    const docs = await this.docDao.getAll({
      createdBy: graphCreatedBy,
      tags: tagsFilter,
      projection: ['id', 'title', 'tags', 'updatedAt'],
      order: { updatedAt: 'DESC' },
    });

    if (docs.length === 0) {
      return { output: [] };
    }

    const embeddings = await this.embedTexts([normalizedQuery]);
    const queryVector = embeddings[0] ?? [];
    if (queryVector.length === 0) {
      throw new BadRequestException('EMBEDDING_FAILED');
    }

    const topK = args.topK;
    const docIds = docs.map((doc) => doc.id);
    const docById = new Map(docs.map((doc) => [doc.id, doc]));
    const chunks = await this.chunkDao.getAll({
      docIds,
      embedding: this.toPgVector(queryVector),
      rawData: true,
      limit: topK,
      projection: ['id', 'docId', 'text', 'score'],
      order: { score: 'DESC' },
    });

    const grouped = new Map<string, KnowledgeSearchResult>();

    for (const chunk of chunks) {
      const docId = chunk.docId;
      const doc = docById.get(docId);
      if (!doc) continue;
      const existing = grouped.get(docId) ?? {
        documentId: doc.id,
        documentTitle: doc.title,
        tags: doc.tags ?? [],
        chunks: [],
      };
      existing.chunks.push({
        chunkId: chunk.id,
        text: chunk.text,
        score: Number(chunk.score),
      });
      grouped.set(docId, existing);
    }

    const output = Array.from(grouped.values()).map((item) => ({
      documentTitle: item.documentTitle,
      documentId: item.documentId,
      tags: item.tags,
      chunks: item.chunks,
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
    args: KnowledgeSearchSchemaType,
    _config: KnowledgeToolGroupConfig,
  ): string {
    return `Knowledge search: ${args.query}`;
  }

  private async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.openaiService.embeddings({
      model: this.llmModelsService.getKnowledgeEmbeddingModel(),
      input: texts,
    });
  }

  private normalizeTags(
    argsTags?: string[],
    nodeTags?: string[],
  ): string[] | undefined {
    const merged = new Set<string>();
    for (const tag of argsTags ?? []) {
      const normalized = tag.trim().toLowerCase();
      if (normalized) merged.add(normalized);
    }
    for (const tag of nodeTags ?? []) {
      const normalized = tag.trim().toLowerCase();
      if (normalized) merged.add(normalized);
    }
    return merged.size ? Array.from(merged) : undefined;
  }

  private toPgVector(values: number[]): string {
    const sanitized = values.map((value) =>
      Number.isFinite(value) ? value : 0,
    );
    return `[${sanitized.join(',')}]`;
  }
}
