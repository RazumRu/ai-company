import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable, Scope } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { KnowledgeChunkDao } from '../../../../knowledge/dao/knowledge-chunk.dao';
import { KnowledgeDocDao } from '../../../../knowledge/dao/knowledge-doc.dao';
import { KnowledgeChunkEntity } from '../../../../knowledge/entity/knowledge-chunk.entity';
import { zodToAjvSchema } from '../../../agent-tools.utils';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

export const KnowledgeGetChunksSchema = z.object({
  docId: z.uuid().describe('Document ID'),
  chunkIds: z.array(z.uuid()).min(1).describe('Chunk IDs to retrieve'),
});

export type KnowledgeGetChunksSchemaType = z.infer<
  typeof KnowledgeGetChunksSchema
>;

@Injectable({ scope: Scope.TRANSIENT })
export class KnowledgeGetChunksTool extends BaseTool<
  KnowledgeGetChunksSchemaType,
  KnowledgeToolGroupConfig
> {
  public name = 'knowledge_get_chunks';
  public description = 'Fetch full text for selected knowledge chunks.';

  constructor(
    private readonly docDao: KnowledgeDocDao,
    private readonly chunkDao: KnowledgeChunkDao,
  ) {
    super();
  }

  public getDetailedInstructions(
    _config: KnowledgeToolGroupConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
      ### Overview
      Returns the full content for specific chunks you already selected from knowledge_search.

      ### When to Use
      After you have selected chunkIds from knowledge_search and need the full text for those chunks.

      ### Best Practices
      Request only the chunks you need. Keep chunkIds focused to limit context size.

      ### Examples
      \`\`\`json
      {"docId": "2b0c3f5a-1f2c-4c2d-9c33-1ad9c1c1a123", "chunkIds": ["c2b3d4e5-6f70-4a8b-9c10-11aa22bb33cc"]}
      \`\`\`
    `;
  }

  public get schema() {
    return zodToAjvSchema(KnowledgeGetChunksSchema);
  }

  public async invoke(
    args: KnowledgeGetChunksSchemaType,
    config: KnowledgeToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<unknown>> {
    const graphCreatedBy = runnableConfig.configurable?.graph_created_by;
    if (!graphCreatedBy) {
      throw new BadRequestException(undefined, 'graph_created_by is required');
    }

    if (!args.chunkIds.length) {
      return { output: [] };
    }

    const chunks = await this.chunkDao.getAll({
      docId: args.docId,
      ids: args.chunkIds,
      projection: [
        'id',
        'docId',
        'chunkIndex',
        'text',
        'startOffset',
        'endOffset',
      ],
      order: { chunkIndex: 'ASC' },
    });

    const output = chunks.map((chunk) => this.prepareChunkResponse(chunk));

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

  private prepareChunkResponse(entity: KnowledgeChunkEntity): {
    text: string;
    startOffset: number;
    endOffset: number;
  } {
    return {
      text: entity.text,
      startOffset: entity.startOffset,
      endOffset: entity.endOffset,
    };
  }
}
