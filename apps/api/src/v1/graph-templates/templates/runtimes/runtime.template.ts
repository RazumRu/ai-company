import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { GraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import { RuntimeType } from '../../../runtime/runtime.types';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
import { RuntimeThreadProvider } from '../../../runtime/services/runtime-thread-provider';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { RuntimeNodeBaseTemplate } from '../base-node.template';

const CommonFieldsShape = {
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Environment variables'),
  initScript: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('Initialization commands')
    .meta({ 'x-ui:textarea': true }),
  initScriptTimeoutMs: z
    .number()
    .positive()
    .default(600_000)
    .optional()
    .describe(`Timeout in milliseconds for initialization script execution`),
};

const DockerBranchSchema = z
  .object({
    runtimeType: z
      .literal(RuntimeType.Docker)
      .meta({ 'x-ui:show-on-node': true })
      .meta({ 'x-ui:label': 'Runtime' }),
    labels: z
      .record(z.string(), z.string())
      .optional()
      .describe('Docker labels'),
  })
  .extend(CommonFieldsShape)
  .strip();

const DaytonaBranchSchema = z
  .object({
    runtimeType: z
      .literal(RuntimeType.Daytona)
      .meta({ 'x-ui:show-on-node': true })
      .meta({ 'x-ui:label': 'Runtime' }),
    labels: z
      .record(z.string(), z.string())
      .optional()
      .describe('Sandbox labels'),
  })
  .extend(CommonFieldsShape)
  .strip();

export const RuntimeTemplateSchema = z.discriminatedUnion('runtimeType', [
  DockerBranchSchema,
  DaytonaBranchSchema,
]);

export type RuntimeTemplateSchemaType = z.infer<typeof RuntimeTemplateSchema>;

@Injectable()
@RegisterTemplate()
export class RuntimeTemplate extends RuntimeNodeBaseTemplate<
  typeof RuntimeTemplateSchema
> {
  readonly id = 'runtime';
  readonly name = 'Runtime';
  readonly description = 'Runtime environment for executing code';
  readonly schema = RuntimeTemplateSchema;

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
    {
      type: 'template',
      value: 'subagents-tool',
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
      provide: async (params: GraphNode<RuntimeTemplateSchemaType>) => {
        return new RuntimeThreadProvider(this.runtimeProvider, {
          graphId: params.metadata.graphId,
          runtimeNodeId: params.metadata.nodeId,
          runtimeStartParams: params.config,
          type: params.config.runtimeType,
          temporary: params.metadata.temporary ?? false,
        });
      },
      configure: async (
        params: GraphNode<RuntimeTemplateSchemaType>,
        instance: RuntimeThreadProvider,
      ) => {
        instance.setParams({
          graphId: params.metadata.graphId,
          runtimeNodeId: params.metadata.nodeId,
          runtimeStartParams: params.config,
          type: params.config.runtimeType,
          temporary: params.metadata.temporary ?? false,
        });
      },
      destroy: async (instance: RuntimeThreadProvider) => {
        await instance.cleanup();
      },
    };
  }
}
