import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable, Scope } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { KnowledgeDocDao } from '../../../../knowledge/dao/knowledge-doc.dao';
import { KnowledgeChunksService } from '../../../../knowledge/services/knowledge-chunks.service';
import { QdrantService } from '../../../../qdrant/services/qdrant.service';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

export const KnowledgeGetChunksSchema = z.object({
  chunkIds: z
    .array(z.number().int().positive())
    .min(1)
    .describe('Chunk public IDs to retrieve'),
});

export type KnowledgeGetChunksSchemaType = z.infer<
  typeof KnowledgeGetChunksSchema
>;

export type KnowledgeGetChunksOutput = {
  chunkPublicId: number;
  docPublicId: number | null;
  text: string;
  startOffset: number;
  endOffset: number;
}[];

@Injectable({ scope: Scope.TRANSIENT })
export class KnowledgeGetChunksTool extends BaseTool<
  KnowledgeGetChunksSchemaType,
  KnowledgeToolGroupConfig
> {
  public name = 'knowledge_get_chunks';
  public description = 'Fetch full text for selected knowledge chunks.';

  constructor(
    private readonly docDao: KnowledgeDocDao,
    private readonly qdrantService: QdrantService,
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
      Returns the full content for specific chunks you already selected from knowledge_search_chunks.

      ### When to Use
      After you have selected chunkIds from knowledge_search_chunks and need the full text for those chunks.
      If the document politic instructs full content retrieval, use knowledge_get_doc instead.
      If you already fetched full content for a document, do NOT fetch its chunks.

      ### Best Practices
      Request only the chunks you need. Keep chunkIds focused to limit context size.

      ### Examples
      \`\`\`json
      {"chunkIds": [501]}
      \`\`\`
    `;
  }

  public get schema() {
    return KnowledgeGetChunksSchema;
  }

  public async invoke(
    args: KnowledgeGetChunksSchemaType,
    config: KnowledgeToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<KnowledgeGetChunksOutput>> {
    const graphCreatedBy = runnableConfig.configurable?.graph_created_by;
    if (!graphCreatedBy) {
      throw new BadRequestException(undefined, 'graph_created_by is required');
    }

    if (!args.chunkIds.length) {
      return { output: [] };
    }

    const collection = await this.knowledgeChunksService.getCollectionName();
    const chunks = await this.qdrantService.scrollAll(collection, {
      filter: this.buildChunkFilter(args.chunkIds),
      with_payload: true,
    } as Parameters<QdrantService['scrollAll']>[1]);

    if (chunks.length === 0) {
      return { output: [] };
    }

    const tagsFilter = this.normalizeTags(config.tags);
    const parsedChunks = chunks
      .map((chunk) => this.parseChunkPayload(chunk))
      .filter((chunk): chunk is StoredChunkPayload => Boolean(chunk));
    parsedChunks.sort((a, b) => {
      if (a.docId !== b.docId) {
        return a.docId.localeCompare(b.docId);
      }
      return a.chunkIndex - b.chunkIndex;
    });
    const docIds = Array.from(
      new Set(parsedChunks.map((chunk) => chunk.docId)),
    );
    const docs = await this.docDao.getAll({
      ids: docIds,
      createdBy: graphCreatedBy,
      tags: tagsFilter,
      projection: ['id', 'publicId', 'tags'],
    });
    const allowedDocs = tagsFilter?.length
      ? docs.filter((doc) => this.hasMatchingTag(doc.tags ?? [], tagsFilter))
      : docs;
    const allowedDocIds = new Set(allowedDocs.map((doc) => doc.id));
    const docPublicIdById = new Map(
      allowedDocs.map((doc) => [doc.id, doc.publicId] as const),
    );
    const output = parsedChunks
      .filter((chunk) => allowedDocIds.has(chunk.docId))
      .map((chunk) =>
        this.prepareChunkResponse(
          chunk,
          docPublicIdById.get(chunk.docId) ?? null,
        ),
      );

    const title = this.generateTitle?.(args, config);

    return {
      output,
      messageMetadata: {
        __title: title,
      },
    };
  }

  protected override generateTitle(
    args: KnowledgeGetChunksSchemaType,
    _config: KnowledgeToolGroupConfig,
  ): string {
    return `Fetch knowledge chunks (${args.chunkIds.length})`;
  }

  private prepareChunkResponse(
    entity: StoredChunkPayload,
    docPublicId: number | null,
  ): {
    chunkPublicId: number;
    docPublicId: number | null;
    text: string;
    startOffset: number;
    endOffset: number;
  } {
    return {
      chunkPublicId: entity.publicId,
      docPublicId,
      text: entity.text,
      startOffset: entity.startOffset,
      endOffset: entity.endOffset,
    };
  }

  private parseChunkPayload(
    point: Awaited<ReturnType<QdrantService['scrollAll']>>[number],
  ): StoredChunkPayload | null {
    const payload = point.payload ?? {};
    const docId = this.getString(payload.docId);
    const text = this.getString(payload.text);
    if (!docId || !text) return null;

    return {
      id: String(point.id),
      docId,
      publicId: this.getNumber(payload.publicId) ?? 0,
      chunkIndex: this.getNumber(payload.chunkIndex) ?? 0,
      text,
      startOffset: this.getNumber(payload.startOffset) ?? 0,
      endOffset: this.getNumber(payload.endOffset) ?? 0,
    };
  }

  private getString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  private getNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private normalizeTags(tags?: string[]): string[] | undefined {
    const merged = new Set<string>();
    for (const tag of tags ?? []) {
      const normalized = tag.trim().toLowerCase();
      if (normalized) merged.add(normalized);
    }
    return merged.size ? Array.from(merged) : undefined;
  }

  private hasMatchingTag(tags: string[], filter: string[]): boolean {
    const normalized = new Set(tags.map((tag) => tag.trim().toLowerCase()));
    return filter.some((tag) => normalized.has(tag));
  }

  private buildChunkFilter(chunkPublicIds: number[]) {
    if (chunkPublicIds.length === 1) {
      return {
        must: [
          {
            key: 'publicId',
            match: { value: chunkPublicIds[0] },
          },
        ],
      };
    }

    return {
      must: [
        {
          key: 'publicId',
          match: { any: chunkPublicIds },
        },
      ],
    };
  }
}

type StoredChunkPayload = {
  id: string;
  docId: string;
  publicId: number;
  chunkIndex: number;
  text: string;
  startOffset: number;
  endOffset: number;
};
