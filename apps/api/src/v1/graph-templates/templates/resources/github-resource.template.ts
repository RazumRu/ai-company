import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';

import { ResourceKind } from '../../../graph-resources/graph-resources.types';
import {
  GithubResource,
  IGithubResourceOutput,
} from '../../../graph-resources/services/github-resource';
import type { GraphNode } from '../../../graphs/graphs.types';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { ResourceNodeBaseTemplate } from '../base-node.template';

export const GithubResourceTemplateSchema = z
  .object({
    patToken: z
      .string()
      .min(1, 'GitHub PAT token cannot be empty')
      .describe('GitHub pat token'),
    name: z.string().optional().describe('Git user name to configure'),
    email: z.email().optional().describe('Email'),
    auth: z
      .boolean()
      .default(true)
      .describe('Whether to authenticate with GitHub'),
  })
  // Strip legacy/unknown fields so older configs remain valid.
  .strip();

export type GithubResourceTemplateSchemaType = z.infer<
  typeof GithubResourceTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class GithubResourceTemplate extends ResourceNodeBaseTemplate<
  typeof GithubResourceTemplateSchema,
  IGithubResourceOutput
> {
  readonly id = 'github-resource';
  readonly name = 'GitHub';
  readonly description =
    'GitHub resource providing environment for shell execution';
  readonly schema = GithubResourceTemplateSchema;

  readonly inputs = [
    {
      type: 'template',
      value: 'shell-tool',
      multiple: true,
    },
    {
      type: 'template',
      value: 'gh-tool',
      multiple: true,
    },
  ] as const;

  constructor(private readonly moduleRef: ModuleRef) {
    super();
  }

  public async create() {
    let resourceService: GithubResource;

    return {
      provide: async (params: GraphNode<GithubResourceTemplateSchemaType>) => {
        resourceService = await this.createNewInstance(
          this.moduleRef,
          GithubResource,
        );
        // Setup must happen in configure(). Provide must be side-effect free.
        return {
          information: '',
          kind: ResourceKind.Shell,
          patToken: params.config.patToken,
          data: {},
        } satisfies IGithubResourceOutput;
      },
      configure: async (
        params: GraphNode<GithubResourceTemplateSchemaType>,
        instance: IGithubResourceOutput,
      ) => {
        if (!resourceService) {
          throw new Error('RESOURCE_SERVICE_NOT_INITIALIZED');
        }

        const config = params.config;
        if (resourceService.setup) {
          await resourceService.setup(config);
        }
        const newData = await resourceService.getData(config);
        // Update the instance in-place
        Object.assign(instance, newData);
      },
      destroy: async (_instance: IGithubResourceOutput) => {
        // No cleanup needed for resource
      },
    };
  }
}
