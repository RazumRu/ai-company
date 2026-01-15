import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { environment } from '../../../../environments';
import type { GraphNode } from '../../../graphs/graphs.types';
import { NodeKind } from '../../../graphs/graphs.types';
import { RuntimeType } from '../../../runtime/runtime.types';
import { DockerRuntime } from '../../../runtime/services/docker-runtime';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
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
  // Strip legacy/unknown fields so older configs remain valid.
  .strip();

export type DockerRuntimeTemplateSchemaType = z.infer<
  typeof DockerRuntimeTemplateSchema
>;

@Injectable()
@RegisterTemplate()
export class DockerRuntimeTemplate extends RuntimeNodeBaseTemplate<
  typeof DockerRuntimeTemplateSchema,
  DockerRuntime
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
    let configuredOnce = false;

    return {
      provide: async (params: GraphNode<DockerRuntimeTemplateSchemaType>) => {
        const config = params.config;

        // RuntimeProvider currently returns BaseRuntime, but for RuntimeType.Docker it is DockerRuntime.
        const runtime = (await this.runtimeProvider.provide({
          type: config.runtimeType,
        })) as DockerRuntime;

        return runtime;
      },
      configure: async (
        params: GraphNode<DockerRuntimeTemplateSchemaType>,
        instance: DockerRuntime,
      ) => {
        await this.startOrRestartRuntime(params, instance, {
          stopFirst: configuredOnce,
        });
        configuredOnce = true;
      },
      destroy: async (instance: DockerRuntime) => {
        await Promise.race([
          instance.stop(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('Runtime stop timeout')), 15000),
          ),
        ]).catch(() => {});
      },
    };
  }

  private async startOrRestartRuntime(
    params: GraphNode<DockerRuntimeTemplateSchemaType>,
    runtime: DockerRuntime,
    opts: { stopFirst: boolean },
  ): Promise<void> {
    const config = params.config;
    const metadata = params.metadata;

    // Automatically add graph_id, node_id, and version labels for container management
    const systemLabels: Record<string, string> = {
      'ai-company/graph_id': metadata.graphId,
      'ai-company/node_id': metadata.nodeId,
      'ai-company/graph_version': metadata.version,
      'ai-company/dind': 'false',
    };

    if (metadata.temporary) {
      systemLabels['ai-company/temporary'] = 'true';
    }

    const mergedLabels = {
      ...config.labels,
      ...systemLabels,
    };

    const existingContainer = await DockerRuntime.getByLabels(mergedLabels);
    const networkName = `ai-company-${metadata.graphId}`;
    const containerName = `rt-${metadata.graphId}-${metadata.nodeId}`;
    const shouldRecreate = !existingContainer;

    if (opts.stopFirst) {
      await Promise.race([
        runtime.stop(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Runtime stop timeout')), 15000),
        ),
      ]).catch(() => {});
    }

    // Use environment defaults for registry mirrors when enableDind is true
    const registryMirrors =
      config.enableDind && environment.dockerRegistryMirror
        ? [environment.dockerRegistryMirror as string]
        : undefined;

    const insecureRegistries =
      config.enableDind && environment.dockerInsecureRegistry
        ? [environment.dockerInsecureRegistry as string]
        : undefined;

    await runtime.start({
      image: config.image,
      env: config.env,
      labels: mergedLabels,
      initScript: config.initScript,
      initScriptTimeoutMs: config.initScriptTimeoutMs,
      recreate: shouldRecreate,
      containerName,
      network: networkName,
      enableDind: config.enableDind,
      registryMirrors,
      insecureRegistries,
    });
  }
}
