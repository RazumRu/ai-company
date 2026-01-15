import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { GraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import { RuntimeType } from '../../../runtime/runtime.types';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
import { RuntimeThreadProvider } from '../../../runtime/services/runtime-thread-provider';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { RuntimeNodeBaseTemplate } from '../base-node.template';

export const DockerRuntimeTemplateSchema = z
  .object({
    runtimeType: z
      .literal(RuntimeType.Docker)
      .meta({ 'x-ui:show-on-node': true })
      .meta({ 'x-ui:label': 'Runtime' }),
    image: z
      .string()
      .optional()
      .describe('Docker image to use. If not set - will use default image')
      .meta({ 'x-ui:show-on-node': true })
      .meta({ 'x-ui:label': 'Image' }),
    env: z
      .record(z.string(), z.string())
      .optional()
      .describe('Environment variables'),
    labels: z
      .record(z.string(), z.string())
      .optional()
      .describe('Docker labels'),
    initScript: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Initialization commands')
      .meta({ 'x-ui:textarea': true }),
    initScriptTimeoutMs: z
      .number()
      .positive()
      .optional()
      .default(600_000)
      .describe(`Timeout in milliseconds for initialization script execution`),
    enableDind: z
      .boolean()
      .optional()
      .describe(
        'Enable Docker-in-Docker by creating a separate DIND container for this runtime',
      ),
  })
  .strip();

export type DockerRuntimeTemplateSchemaType = z.infer<
  typeof DockerRuntimeTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class DockerRuntimeTemplate extends RuntimeNodeBaseTemplate<
  typeof DockerRuntimeTemplateSchema
> {
  readonly id = 'docker-runtime';
  readonly name = 'Docker';
  readonly description = 'Docker runtime environment for executing code';
  readonly schema = DockerRuntimeTemplateSchema;

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
    {
      type: 'template',
      value: 'files-tool',
      multiple: true,
    },
    // MCP nodes can run inside this runtime as well.
    {
      type: 'kind',
      value: NodeKind.Mcp,
      multiple: true,
    },
  ] as const;

  constructor(private readonly runtimeProvider: RuntimeProvider) {
    super();
  }

  public async create() {
    return {
      provide: async (params: GraphNode<DockerRuntimeTemplateSchemaType>) => {
        return new RuntimeThreadProvider(this.runtimeProvider, {
          graphId: params.metadata.graphId,
          runtimeNodeId: params.metadata.nodeId,
          runtimeStartParams: params.config,
          type: RuntimeType.Docker,
          temporary: params.metadata.temporary ?? false,
        });
      },
      configure: async (
        params: GraphNode<DockerRuntimeTemplateSchemaType>,
        instance: RuntimeThreadProvider,
      ) => {
        instance.setParams({
          graphId: params.metadata.graphId,
          runtimeNodeId: params.metadata.nodeId,
          runtimeStartParams: params.config,
          type: RuntimeType.Docker,
          temporary: params.metadata.temporary ?? false,
        });
      },
      destroy: async (instance: RuntimeThreadProvider) => {
        await instance.cleanup();
      },
    };
  }
}
