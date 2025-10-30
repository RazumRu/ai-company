import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { IShellResourceOutput } from '../../../graph-resources/graph-resources.types';
import { GithubResource } from '../../../graph-resources/services/github-resource';
import { CompiledGraphNode } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  ResourceNodeBaseTemplate,
} from '../base-node.template';

export const GithubResourceTemplateSchema = z
  .object({
    patToken: z
      .string()
      .min(1, 'GitHub PAT token cannot be empty')
      .describe('GitHub pat token'),
    name: z.string().optional().describe('Git user name to configure'),
    avatar: z.string().optional().describe('Avatar URL'),
    auth: z
      .boolean()
      .default(true)
      .describe('Whether to authenticate with GitHub (default: true)'),
  })
  .strict();

@Injectable()
@RegisterTemplate()
export class GithubResourceTemplate extends ResourceNodeBaseTemplate<
  typeof GithubResourceTemplateSchema,
  IShellResourceOutput
> {
  readonly name = 'github-resource';
  readonly description =
    'GitHub resource providing environment for shell execution';
  readonly schema = GithubResourceTemplateSchema;

  readonly inputs = [
    {
      type: 'template',
      value: 'shell-tool',
      multiple: true,
    },
  ] as const;

  constructor(private readonly githubResource: GithubResource) {
    super();
  }

  async create(
    config: z.infer<typeof GithubResourceTemplateSchema>,
    _inputNodes: Map<string, CompiledGraphNode>,
    _outputNodes: Map<string, CompiledGraphNode>,
    _metadata: NodeBaseTemplateMetadata,
  ): Promise<IShellResourceOutput> {
    if (this.githubResource.setup) {
      await this.githubResource.setup(config);
    }

    return this.githubResource.getData(config);
  }
}
