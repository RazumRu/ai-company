import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable, Scope } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { KnowledgeDocDao } from '../../../../knowledge/dao/knowledge-doc.dao';
import { KnowledgeDocEntity } from '../../../../knowledge/entity/knowledge-doc.entity';
import { LlmModelsService } from '../../../../litellm/services/llm-models.service';
import { OpenaiService } from '../../../../openai/openai.service';
import { zodToAjvSchema } from '../../../agent-tools.utils';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

export const KnowledgeSearchDocsSchema = z.object({
  query: z.string().min(1).describe('Natural language query to search for'),
});

export type KnowledgeSearchDocsSchemaType = z.infer<
  typeof KnowledgeSearchDocsSchema
>;

export type KnowledgeSearchDocsResult = {
  documentId: string;
  title: string;
  summary: string | null;
  politic: string | null;
  tags: string[];
};

type KnowledgeDocSelection = {
  ids: string[];
};

@Injectable({ scope: Scope.TRANSIENT })
export class KnowledgeSearchDocsTool extends BaseTool<
  KnowledgeSearchDocsSchemaType,
  KnowledgeToolGroupConfig
> {
  public name = 'knowledge_search_docs';
  public description =
    'Search knowledge documents by title/summary/tags and return relevant docs.';

  constructor(
    private readonly docDao: KnowledgeDocDao,
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
      Searches knowledge documents using only title/summary/tags and returns the most relevant documents.

      ### When to Use
      Use this tool first to find which documents are relevant to your query.

      ### Best Practices
      Keep queries short and focused. This tool returns up to 10 docs.

      ### Examples
      \`\`\`json
      {"query": "database migration checklist"}
      \`\`\`
    `;
  }

  public get schema() {
    return zodToAjvSchema(KnowledgeSearchDocsSchema);
  }

  public async invoke(
    args: KnowledgeSearchDocsSchemaType,
    config: KnowledgeToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<KnowledgeSearchDocsResult[]>> {
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
      tags: tagsFilter,
      projection: ['id', 'title', 'summary', 'politic', 'tags', 'updatedAt'],
      order: { updatedAt: 'DESC' },
    });

    if (docs.length === 0) {
      return { output: [] };
    }

    const selectedIds = await this.selectRelevantDocs(normalizedQuery, docs);

    const docById = new Map(docs.map((doc) => [doc.id, doc]));
    const output = selectedIds
      .map((id) => docById.get(id))
      .filter((doc): doc is (typeof docs)[number] => Boolean(doc))
      .slice(0, 10)
      .map((doc) => ({
        documentId: doc.id,
        title: doc.title,
        summary: doc.summary ?? null,
        politic: doc.politic ?? null,
        tags: doc.tags ?? [],
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
    args: KnowledgeSearchDocsSchemaType,
    _config: KnowledgeToolGroupConfig,
  ): string {
    return `Knowledge docs search: ${args.query}`;
  }

  private normalizeTags(tags?: string[]): string[] | undefined {
    const merged = new Set<string>();
    for (const tag of tags ?? []) {
      const normalized = tag.trim().toLowerCase();
      if (normalized) merged.add(normalized);
    }
    return merged.size ? Array.from(merged) : undefined;
  }

  private async selectRelevantDocs(
    query: string,
    docs: KnowledgeDocEntity[],
  ): Promise<string[]> {
    const prompt = [
      'You select relevant knowledge documents for a query.',
      'Return ONLY JSON with key "ids": an array of document IDs.',
      'Rules:',
      '- ids must come from the provided documents.',
      '- return at most 10 ids.',
      '- if nothing is relevant, return an empty array.',
      '',
      `QUERY: ${query}`,
      'DOCUMENTS:',
      docs.map(
        (d) =>
          `[Document ID: ${d.id}] ${d.title}\n${d.summary}\n[Politic] ${d.politic ?? 'N/A'}\n[Tags] ${d.tags.join()}`,
      ),
    ].join('\n');

    const response = await this.openaiService.response<KnowledgeDocSelection>(
      { message: prompt },
      {
        model: this.llmModelsService.getKnowledgeSearchModel(),
        reasoning: { effort: 'low' },
      },
      { json: true },
    );

    const rawSelection = response.content?.ids ?? [];
    const validIds = new Set(docs.map((doc) => doc.id));
    const selection = Array.from(new Set(rawSelection))
      .filter((id) => validIds.has(id))
      .slice(0, 10);

    if (selection.length > 0) {
      const extra = this.scoreDocs(query, docs)
        .map((doc) => doc.id)
        .filter((id) => !selection.includes(id));
      return [...selection, ...extra].slice(0, 10);
    }

    return this.scoreDocs(query, docs)
      .map((doc) => doc.id)
      .slice(0, 10);
  }

  private scoreDocs(
    query: string,
    docs: KnowledgeDocEntity[],
  ): KnowledgeDocEntity[] {
    const keywords = this.extractKeywords(query);
    if (keywords.length === 0) {
      return docs;
    }
    const scored = docs.map((doc) => {
      const haystack = [doc.title, doc.summary ?? '', doc.tags.join(' ')]
        .join(' ')
        .toLowerCase();
      const score = keywords.reduce(
        (sum, keyword) =>
          haystack.includes(keyword.toLowerCase()) ? sum + 1 : sum,
        0,
      );
      return { doc, score };
    });
    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.doc);
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
}
