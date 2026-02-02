import { ToolRunnableConfig } from '@langchain/core/tools';
import { Injectable, Scope } from '@nestjs/common';
import { BadRequestException } from '@packages/common';
import dedent from 'dedent';
import { z } from 'zod';

import { BaseAgentConfigurable } from '../../../../agents/services/nodes/base-node';
import { KnowledgeDocDao } from '../../../../knowledge/dao/knowledge-doc.dao';
import { KnowledgeDocEntity } from '../../../../knowledge/entity/knowledge-doc.entity';
import { LitellmService } from '../../../../litellm/services/litellm.service';
import { LlmModelsService } from '../../../../litellm/services/llm-models.service';
import {
  CompleteJsonData,
  OpenaiService,
  ResponseJsonData,
} from '../../../../openai/openai.service';
import {
  BaseTool,
  ExtendedLangGraphRunnableConfig,
  ToolInvokeResult,
} from '../../base-tool';
import { KnowledgeToolGroupConfig } from './knowledge-tools.types';

export const KnowledgeSearchDocsSchema = z.object({
  task: z
    .string()
    .min(1)
    .describe('Current task description for selecting relevant documents'),
});

export type KnowledgeSearchDocsSchemaType = z.infer<
  typeof KnowledgeSearchDocsSchema
>;

export type KnowledgeSearchDocsResult = {
  documentPublicId: number;
  title: string;
  summary: string | null;
  politic: string | null;
  tags: string[];
};

type KnowledgeDocSelection = {
  ids: number[];
  comment?: string;
};

const KnowledgeDocSelectionSchema = z.object({
  ids: z.array(z.number().int().positive()).max(10).default([]),
  comment: z.string().min(1).nullable().default(null),
});

export type KnowledgeSearchDocsResponse = {
  documents: KnowledgeSearchDocsResult[];
  comment?: string;
};

@Injectable({ scope: Scope.TRANSIENT })
export class KnowledgeSearchDocsTool extends BaseTool<
  KnowledgeSearchDocsSchemaType,
  KnowledgeToolGroupConfig
> {
  public name = 'knowledge_search_docs';
  public description =
    'Select relevant knowledge documents for the current task and return an optional report.';

  constructor(
    private readonly docDao: KnowledgeDocDao,
    private readonly openaiService: OpenaiService,
    private readonly llmModelsService: LlmModelsService,
    private readonly litellmService: LitellmService,
  ) {
    super();
  }

  public getDetailedInstructions(
    _config: KnowledgeToolGroupConfig,
    _lgConfig?: ExtendedLangGraphRunnableConfig,
  ): string {
    return dedent`
    ### Overview
    Selects relevant knowledge documents for the current task.

    ### When to Use
    Use this tool first to find which documents are relevant to your current task.
    Always use this tool for any non-trivial technical work, including both implementation and research/design work (e.g. architecture proposals, RFC/ADR).

    Call this tool at the start if the task involves any of:
    - implementing/changing code (implementation, refactor, bugfix)
    - writing/updating tests
    - research / architecture exploration (design, RFC, ADR, comparing approaches)
    - investigating how the repo/system works (modules, flows, conventions)
    - CI/CD, infra, deployment, configuration
    - security/permissions, auth flows, policies
    - repo conventions, coding standards, “how we do X here”

    Skip this tool for short/simple questions that don’t need project context (e.g., "what’s the weather", "what is HTTP", "explain JSON").

    ### Best Practices
    Provide a clear task description and the relevant stack context (technology, language, framework).
    This tool returns up to 10 docs and may include a short report.
    If no documents are returned, read the comment for refinement tips and rerun with a better query.
    Use the returned document public IDs to reference documents in other knowledge tools.

    ### Examples
    \`\`\`json
    {"task": "Prepare a database migration checklist for schema changes. Stack: NestJS + TypeScript + TypeORM"}
    \`\`\`
  `;
  }

  public get schema() {
    return KnowledgeSearchDocsSchema;
  }

  public async invoke(
    args: KnowledgeSearchDocsSchemaType,
    config: KnowledgeToolGroupConfig,
    runnableConfig: ToolRunnableConfig<BaseAgentConfigurable>,
  ): Promise<ToolInvokeResult<KnowledgeSearchDocsResponse>> {
    const graphCreatedBy = runnableConfig.configurable?.graph_created_by;
    if (!graphCreatedBy) {
      throw new BadRequestException(undefined, 'graph_created_by is required');
    }

    const normalizedTask = args.task.trim();
    if (!normalizedTask) {
      throw new BadRequestException('TASK_REQUIRED');
    }

    const tagsFilter = this.normalizeTags(config.tags);

    const docs = await this.docDao.getAll({
      createdBy: graphCreatedBy,
      tags: tagsFilter,
      projection: [
        'id',
        'publicId',
        'title',
        'summary',
        'politic',
        'tags',
        'updatedAt',
      ],
      order: { updatedAt: 'DESC' },
    });

    if (docs.length === 0) {
      return { output: { documents: [] } };
    }

    const selection = await this.selectRelevantDocs(normalizedTask, docs);

    const docByPublicId = new Map(docs.map((doc) => [doc.publicId, doc]));
    const documents = selection.ids
      .map((id) => docByPublicId.get(id))
      .filter((doc): doc is (typeof docs)[number] => Boolean(doc))
      .slice(0, 10)
      .map((doc) => ({
        documentPublicId: doc.publicId,
        title: doc.title,
        summary: doc.summary ?? null,
        politic: doc.politic ?? null,
        tags: doc.tags ?? [],
      }));

    const title = this.generateTitle?.(args, config);

    return {
      output: {
        documents,
        comment: selection.comment,
      },
      messageMetadata: {
        __title: title,
      },
    };
  }

  protected override generateTitle(
    args: KnowledgeSearchDocsSchemaType,
    _config: KnowledgeToolGroupConfig,
  ): string {
    return `Knowledge docs selection: ${args.task}`;
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
    task: string,
    docs: KnowledgeDocEntity[],
  ): Promise<KnowledgeDocSelection> {
    const prompt = [
      'You select relevant knowledge documents for a query.',
      'Return ONLY JSON with keys: "ids" (array of document public IDs) and optional "comment" (string).',
      'Rules:',
      '- ids must come from the provided documents.',
      '- return at most 10 ids.',
      '- if nothing is relevant, return an empty array.',
      '- comment should be a brief report; if nothing is relevant, say so and suggest how to refine the task.',
      '',
      `TASK: ${task}`,
      'DOCUMENTS:',
      docs.map(
        (d) =>
          `[Document Public ID: ${d.publicId}] ${d.title}\n[Summary] ${d.summary}\n[Politic] ${d.politic ?? 'N/A'}\n[Tags] ${d.tags.join()}`,
      ),
    ].join('\n');

    const modelName = this.llmModelsService.getKnowledgeSearchModel();
    const supportsResponsesApi =
      await this.litellmService.supportsResponsesApi(modelName);
    const data: ResponseJsonData | CompleteJsonData = {
      model: modelName,
      message: prompt,
      json: true as const,
      jsonSchema: KnowledgeDocSelectionSchema,
    };
    const response = supportsResponsesApi
      ? await this.openaiService.response<KnowledgeDocSelection>(data)
      : await this.openaiService.complete<KnowledgeDocSelection>(data);

    const validation = KnowledgeDocSelectionSchema.safeParse(response.content);
    if (!validation.success) {
      return { ids: [] };
    }

    const rawSelection = validation.data.ids ?? [];
    const validIds = new Set(docs.map((doc) => doc.publicId));
    const ids = Array.from(new Set(rawSelection))
      .filter((id) => validIds.has(id))
      .slice(0, 10);
    const comment = validation.data.comment?.trim();
    return comment ? { ids, comment } : { ids };
  }
}
