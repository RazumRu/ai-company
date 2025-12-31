import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';

import { IBaseKnowledgeOutput } from '../../../agent-knowledge/agent-knowledge.types';
import { SimpleKnowledge } from '../../../agent-knowledge/services/simple-knowledge';
import type { GraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { KnowledgeNodeBaseTemplate } from '../base-node.template';

export const SimpleKnowledgeTemplateSchema = z.object({
  content: z
    .string()
    .min(1)
    .describe('Knowledge content injected into connected agent instructions.')
    .meta({ 'x-ui:textarea': true })
    .meta({ 'x-ui:ai-suggestions': true }),
  repository: z
    .string()
    .min(1)
    .optional()
    .meta({ 'x-ui:show-on-node': true })
    .meta({ 'x-ui:label': 'Repo' })
    .describe(
      'Optional repository name/URL this knowledge is specific to (including clones).',
    ),
});

export type SimpleKnowledgeTemplateSchemaType = z.infer<
  typeof SimpleKnowledgeTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class SimpleKnowledgeTemplate extends KnowledgeNodeBaseTemplate<
  typeof SimpleKnowledgeTemplateSchema,
  IBaseKnowledgeOutput
> {
  readonly id = 'simple-knowledge';
  readonly name = 'Simple knowledge';
  readonly description =
    'Static knowledge block that augments instructions of connected agents.';
  readonly schema = SimpleKnowledgeTemplateSchema;

  readonly inputs = [
    {
      type: 'kind',
      value: NodeKind.SimpleAgent,
      multiple: true,
    },
  ] as const;

  readonly outputs = [] as const;

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  public async create() {
    let knowledgeService: SimpleKnowledge;

    return {
      provide: async (
        _params: GraphNode<SimpleKnowledgeTemplateSchemaType>,
      ) => {
        knowledgeService = await this.createNewInstance(
          this.moduleRef,
          SimpleKnowledge,
        );
        // Setup must happen in configure(). Provide must be side-effect free.
        return { content: '' };
      },
      configure: async (
        params: GraphNode<SimpleKnowledgeTemplateSchemaType>,
        instance: IBaseKnowledgeOutput,
      ) => {
        if (!knowledgeService) {
          throw new Error('KNOWLEDGE_SERVICE_NOT_INITIALIZED');
        }

        const config = params.config;
        const normalizedConfig = this.normalizeConfig(config);

        if (knowledgeService.setup) {
          await knowledgeService.setup(normalizedConfig);
        }

        const newData = await knowledgeService.getData(normalizedConfig);
        // Update the instance in-place
        Object.assign(instance, newData);
      },
      destroy: async (_instance: IBaseKnowledgeOutput) => {
        // No cleanup needed
      },
    };
  }

  private normalizeConfig(
    config: SimpleKnowledgeTemplateSchemaType,
  ): SimpleKnowledgeTemplateSchemaType {
    const baseContent = config.content.trim();
    const repoNote = config.repository
      ? [
          `This knowledge applies only to repository: ${config.repository}.`,
          'Do not reuse it for other repositories.',
          'You may use these instructions when working with this repository, including when cloning or interacting with its copies.',
        ].join(' ')
      : undefined;
    return {
      ...config,
      content: [baseContent, repoNote].filter(Boolean).join('\n\n'),
    };
  }
}
