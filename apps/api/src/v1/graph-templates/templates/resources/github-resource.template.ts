import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { IShellResourceOutput } from '../../../graph-resources/graph-resources.types';
import { GithubResource } from '../../../graph-resources/services/github-resource';
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
  })
  .strict();

@Injectable()
@RegisterTemplate()
export class GithubResourceTemplate extends ResourceNodeBaseTemplate<
  typeof GithubResourceTemplateSchema,
  IShellResourceOutput
> {
  readonly name = 'github-resource';
  readonly description = 'GithHub resource';
  readonly schema = GithubResourceTemplateSchema;

  readonly outputs = [
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
    _connectedNodes: Map<string, any>,
    _metadata: NodeBaseTemplateMetadata,
  ): Promise<IShellResourceOutput> {
    if (this.githubResource.setup) {
      await this.githubResource.setup(config);
    }

    return this.githubResource.getData(config);
  }
}
