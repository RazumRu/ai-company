import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable, Scope } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { zodResponseFormat } from 'openai/helpers/zod';
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

type QueryExpansion = {
  queries: string[];
};

const QueryExpansionSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(5),
});
const QueryExpansionFormat = zodResponseFormat(QueryExpansionSchema, 'data');

const KEYWORD_WINDOW = 120;
const FALLBACK_EDGE = 250;

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
    const queryVariants = await this.generateQueryVariants(normalizedQuery);
    const embeddings = await this.embedTexts(queryVariants);
    if (embeddings.length === 0) {
      throw new BadRequestException('EMBEDDING_FAILED');
    }

    const topK = args.topK ?? 5;
    const perQueryLimit = Math.max(topK, 1);
    const chunkById = new Map<
      string,
      {
        id: string;
        publicId: number;
        docId: string;
        text: string;
        score: number;
      }
    >();

    for (const embedding of embeddings) {
      const queryVector = this.toPgVector(embedding);
      const chunks = await this.chunkDao.getAll({
        docIds,
        embedding: queryVector,
        rawData: true,
        limit: perQueryLimit,
        projection: ['id', 'publicId', 'docId', 'text'],
        order: { score: 'DESC' },
        // updateSelectBuilder: (builder) => {
        //   builder.orderBy('score', 'DESC');
        // },
      });

      for (const chunk of chunks) {
        const score = Number(chunk.score ?? 0);
        const existing = chunkById.get(chunk.id);
        if (!existing || score > existing.score) {
          chunkById.set(chunk.id, {
            id: chunk.id,
            publicId: chunk.publicId,
            docId: chunk.docId,
            text: chunk.text,
            score,
          });
        }
      }
    }

    const keywords = this.extractKeywords(
      [normalizedQuery, ...queryVariants].join(' '),
    );

    const output = Array.from(chunkById.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((chunk) => ({
        chunkId: chunk.id,
        chunkPublicId: chunk.publicId,
        docId: chunk.docId,
        docPublicId: docPublicIdById.get(chunk.docId) ?? null,
        score: chunk.score,
        snippet: this.buildSnippet(chunk.text, keywords),
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

  private async generateQueryVariants(query: string): Promise<string[]> {
    const prompt = [
      'Generate 3-5 short search queries or keyword phrases relevant to the user query.',
      'Return ONLY JSON with key "queries": string[].',
      'Rules:',
      '- include the original query in the list.',
      '- keep each query under 12 words.',
      '- deduplicate queries.',
      '',
      `QUERY: ${query}`,
    ].join('\n');

    const response = await this.openaiService.response<QueryExpansion>(
      { message: prompt },
      {
        ...this.llmModelsService.getKnowledgeSearchParams(),
        text: {
          format: {
            ...QueryExpansionFormat.json_schema,
            schema: QueryExpansionFormat.json_schema.schema!,
            type: 'json_schema',
          },
        },
      },
      { json: true },
    );

    const validation = QueryExpansionSchema.safeParse(response.content);
    if (!validation.success) {
      return [query];
    }

    const unique = new Set<string>();
    unique.add(query);
    for (const item of validation.data.queries) {
      const normalized = item.trim();
      if (normalized) unique.add(normalized);
    }

    return Array.from(unique).slice(0, 5);
  }

  private async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.openaiService.embeddings({
      model: this.llmModelsService.getKnowledgeEmbeddingModel(),
      input: texts,
    });
  }

  private extractKeywords(text: string): string[] {
    const matches = text.toLowerCase().match(/[a-z0-9]+/g);
    if (!matches) return [];
    const unique = new Set<string>();
    for (const match of matches) {
      if (match.length > 2) {
        unique.add(match);
      }
    }
    return Array.from(unique);
  }

  private buildSnippet(text: string, keywords: string[]): string {
    const normalized = this.normalizeWhitespace(text);
    const keywordSnippet = this.buildKeywordSnippet(normalized, keywords);
    if (keywordSnippet) {
      return keywordSnippet;
    }

    const sentenceSnippet = this.buildBestSentenceSnippet(normalized, keywords);
    if (sentenceSnippet) {
      return sentenceSnippet;
    }

    return this.buildEdgeSnippet(normalized);
  }

  private buildKeywordSnippet(text: string, keywords: string[]): string | null {
    if (keywords.length === 0) return null;
    const lower = text.toLowerCase();
    let bestIndex = -1;
    let bestKeyword = '';
    for (const keyword of keywords) {
      const idx = lower.indexOf(keyword.toLowerCase());
      if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
        bestIndex = idx;
        bestKeyword = keyword;
      }
    }

    if (bestIndex === -1) {
      return null;
    }

    const start = Math.max(0, bestIndex - KEYWORD_WINDOW);
    const end = Math.min(
      text.length,
      bestIndex + bestKeyword.length + KEYWORD_WINDOW,
    );
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    return `${prefix}${text.slice(start, end).trim()}${suffix}`;
  }

  private buildBestSentenceSnippet(
    text: string,
    keywords: string[],
  ): string | null {
    const sentences = text.match(/[^.!?]+[.!?]?/g);
    if (!sentences || sentences.length === 0) {
      return null;
    }
    if (keywords.length === 0) {
      return sentences[0]?.trim() ?? null;
    }
    let bestSentence = '';
    let bestScore = 0;
    for (const sentence of sentences) {
      const lowered = sentence.toLowerCase();
      const score = keywords.reduce(
        (sum, keyword) =>
          lowered.includes(keyword.toLowerCase()) ? sum + 1 : sum,
        0,
      );
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sentence.trim();
      }
    }
    return bestScore > 0 ? bestSentence : null;
  }

  private buildEdgeSnippet(text: string): string {
    if (text.length <= FALLBACK_EDGE * 2) {
      return text.trim();
    }
    const start = text.slice(0, FALLBACK_EDGE).trim();
    const end = text.slice(-FALLBACK_EDGE).trim();
    return `${start} ... ${end}`;
  }

  private normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private toPgVector(values: number[]): string {
    const sanitized = values.map((value) =>
      Number.isFinite(value) ? value : 0,
    );
    return `[${sanitized.join(',')}]`;
  }
}
