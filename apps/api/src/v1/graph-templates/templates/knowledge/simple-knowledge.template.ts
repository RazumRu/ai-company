import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { IBaseKnowledgeOutput } from '../../../agent-knowledge/agent-knowledge.types';
import { SimpleKnowledge } from '../../../agent-knowledge/services/simple-knowledge';
import { NodeKind } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  KnowledgeNodeBaseTemplate,
  NodeBaseTemplateMetadata,
} from '../base-node.template';

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

  constructor(private readonly simpleKnowledge: SimpleKnowledge) {
    super();
  }

  async create(
    config: SimpleKnowledgeTemplateSchemaType,
    _inputNodeIds: Set<string>,
    _outputNodeIds: Set<string>,
    _metadata: NodeBaseTemplateMetadata,
  ): Promise<IBaseKnowledgeOutput> {
    const baseContent = config.content.trim();
    const repoNote = config.repository
      ? [
          `This knowledge applies only to repository: ${config.repository}.`,
          'Do not reuse it for other repositories.',
          'You may use these instructions when working with this repository, including when cloning or interacting with its copies.',
        ].join(' ')
      : undefined;
    const normalizedConfig = {
      ...config,
      content: [baseContent, repoNote].filter(Boolean).join('\n\n'),
    };

    if (this.simpleKnowledge.setup) {
      await this.simpleKnowledge.setup(normalizedConfig);
    }

    return this.simpleKnowledge.getData(normalizedConfig);
  }
}
