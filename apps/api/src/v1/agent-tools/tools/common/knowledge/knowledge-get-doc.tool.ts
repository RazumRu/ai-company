import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable, Scope } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { KnowledgeDocDao } from '../../../../knowledge/dao/knowledge-doc.dao';
import { zodToAjvSchema } from '../../../agent-tools.utils';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

export const KnowledgeGetDocSchema = z.object({
  docId: z.uuid().describe('Document ID to retrieve'),
});

export type KnowledgeGetDocSchemaType = z.infer<typeof KnowledgeGetDocSchema>;

export type KnowledgeGetDocResult = {
  documentId: string;
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
    'Fetch the full content of a knowledge document when allowed by its politic.';

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

      ### Permission Rule (Mandatory)
      You can request the full document content only if the document politic instructs you to fetch full content.
      Example: "If this document is relevant to the current task - always fetch the full content instead of fetching only specific chunks."

      ### Examples
      \`\`\`json
      {"docId": "2b0c3f5a-1f2c-4c2d-9c33-1ad9c1c1a123"}
      \`\`\`
    `;
  }

  public get schema() {
    return zodToAjvSchema(KnowledgeGetDocSchema);
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
    const doc = await this.docDao.getOne({
      id: args.docId,
      createdBy: graphCreatedBy,
      tags: tagsFilter,
    });

    if (!doc) {
      return { output: null };
    }

    if (!this.allowsFullContent(doc.politic)) {
      throw new BadRequestException('FULL_CONTENT_NOT_ALLOWED');
    }

    const title = this.generateTitle?.(args, config);

    return {
      output: {
        documentId: doc.id,
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

  private allowsFullContent(politic?: string | null): boolean {
    if (!politic) return false;
    const normalized = politic.toLowerCase();
    return FULL_CONTENT_MARKERS.some((marker) => normalized.includes(marker));
  }
}
