import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable, Scope } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { KnowledgeDocDao } from '../../../../knowledge/dao/knowledge-doc.dao';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

export const KnowledgeGetDocSchema = z.object({
  docId: z
    .number()
    .int()
    .positive()
    .describe(
      'The document public ID to retrieve (obtained from knowledge_search_docs results). The document politic must allow full content retrieval, otherwise this call will fail.',
    ),
});

export type KnowledgeGetDocSchemaType = z.infer<typeof KnowledgeGetDocSchema>;

export type KnowledgeGetDocResult = {
  documentPublicId: number;
  title: string;
  summary: string | null;
  politic: string | null;
  tags: string[];
  content: string;
} | null;

const FULL_CONTENT_MARKERS = [
  'fetch the full content',
  'fetch full content',
  'always fetch the full content',
  'return full content',
  'use full content',
  'full content instead of chunks',
];

@Injectable({ scope: Scope.TRANSIENT })
export class KnowledgeGetDocTool extends BaseTool<
  KnowledgeGetDocSchemaType,
  KnowledgeToolGroupConfig
> {
  public name = 'knowledge_get_doc';
  public description =
    'Retrieve the full content of a single knowledge document by its public ID. This tool is restricted by the document politic (policy) — it will only succeed if the politic explicitly instructs to fetch full content (e.g., "always fetch the full content instead of chunks"). If the politic does not allow full retrieval, use knowledge_search_chunks and knowledge_get_chunks instead. If you already fetched the full document, do not also fetch its chunks.';

  constructor(private readonly docDao: KnowledgeDocDao) {
    super();
  }

  public getDetailedInstructions(
    _config: KnowledgeToolGroupConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Returns the full content for a single knowledge document.

      ### When to Use
      Only after identifying a specific doc ID and when the document politic explicitly allows full content.
      If you already fetched full content for this document, do NOT fetch its chunks.

      ### Permission Rule (Mandatory)
      You can request the full document content only if the document politic instructs you to fetch full content.
      Example: "If this document is relevant to the current task - always fetch the full content instead of fetching only specific chunks."

      ### Examples
      \`\`\`json
      {"docId": 101}
      \`\`\`
    `;
  }

  public get schema() {
    return KnowledgeGetDocSchema;
  }

  public async invoke(
    args: KnowledgeGetDocSchemaType,
    config: KnowledgeToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<KnowledgeGetDocResult>> {
    const graphCreatedBy = runnableConfig.configurable?.graph_created_by;
    if (!graphCreatedBy) {
      throw new BadRequestException(undefined, 'graph_created_by is required');
    }

    const tagsFilter = this.normalizeTags(config.tags);
    const doc = await this.findDoc(args.docId, graphCreatedBy, tagsFilter);

    if (!doc) {
      return { output: null };
    }

    if (!this.allowsFullContent(doc.politic)) {
      throw new BadRequestException('FULL_CONTENT_NOT_ALLOWED');
    }

    const title = this.generateTitle?.(args, config);

    return {
      output: {
        documentPublicId: doc.publicId,
        title: doc.title,
        summary: doc.summary ?? null,
        politic: doc.politic ?? null,
        tags: doc.tags ?? [],
        content: doc.content,
      },
      messageMetadata: {
        __title: title,
      },
    };
  }

  protected override generateTitle(
    args: KnowledgeGetDocSchemaType,
    _config: KnowledgeToolGroupConfig,
  ): string {
    return `Fetch knowledge doc (${args.docId})`;
  }

  private normalizeTags(tags?: string[]): string[] | undefined {
    const merged = new Set<string>();
    for (const tag of tags ?? []) {
      const normalized = tag.trim().toLowerCase();
      if (normalized) merged.add(normalized);
    }
    return merged.size ? Array.from(merged) : undefined;
  }

  private findDoc(
    docId: KnowledgeGetDocSchemaType['docId'],
    createdBy: string,
    tagsFilter?: string[],
  ) {
    return this.docDao.getOne({
      publicId: docId,
      createdBy,
      tags: tagsFilter,
    });
  }

  private allowsFullContent(politic?: string | null): boolean {
    if (!politic) return false;
    const normalized = politic.toLowerCase();
    return FULL_CONTENT_MARKERS.some((marker) => normalized.includes(marker));
  }
}
