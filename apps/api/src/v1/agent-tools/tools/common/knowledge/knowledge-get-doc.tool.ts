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
    'Retrieve the full content of a single knowledge document by its public ID. Only succeeds when the document policy explicitly allows full content retrieval — otherwise use knowledge_search_chunks instead.';

  constructor(private readonly docDao: KnowledgeDocDao) {
    super();
  }

  public getDetailedInstructions(
    _config: KnowledgeToolGroupConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Retrieves the full content of a single knowledge document. Access is controlled by the document's policy (politic) field.

      ### When to Use
      - The document policy explicitly instructs you to fetch full content
      - You need the entire document, not just specific sections

      ### When NOT to Use
      - The document policy does NOT mention full content retrieval → use \`knowledge_search_chunks\` instead
      - You already fetched the full document → do NOT also fetch its chunks (redundant)
      - You only need specific sections → use \`knowledge_search_chunks\` + \`knowledge_get_chunks\`

      ### Permission Rule (Mandatory)
      This tool will **fail** unless the document's politic (policy) field contains an explicit instruction to fetch full content. The policy is returned by \`knowledge_search_docs\` in the \`politic\` field.

      Recognized policy phrases that allow full retrieval:
      - "fetch the full content"
      - "always fetch the full content"
      - "return full content"
      - "full content instead of chunks"

      If the policy does not contain any of these phrases, the tool will return a \`FULL_CONTENT_NOT_ALLOWED\` error.

      ### Workflow
      1. \`knowledge_search_docs\` → check the \`politic\` field of returned documents
      2. If politic says "fetch full content" → use **\`knowledge_get_doc\`**
      3. If politic does NOT say this → use \`knowledge_search_chunks\` + \`knowledge_get_chunks\`

      ### Examples
      **Fetch a document whose politic allows full content:**
      \`\`\`json
      {"docId": 101}
      \`\`\`

      ### Common Errors
      - \`FULL_CONTENT_NOT_ALLOWED\`: The document policy does not permit full retrieval. Use chunk-based tools instead.
      - Document not found: Verify the docId came from \`knowledge_search_docs\` results.
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
