import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { RuntimeType } from '../../../runtime/runtime.types';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import {
  NodeBaseTemplateMetadata,
  RuntimeNodeBaseTemplate,
} from '../base-node.template';

export const DockerRuntimeTemplateSchema = z
  .object({
    runtimeType: z
      .literal(RuntimeType.Docker)
      .meta({ 'x-ui:show-on-node': true }),
    image: z
      .string()
      .optional()
      .describe('Docker image to use. If not set - will use default image')
      .meta({ 'x-ui:show-on-node': true }),
    workdir: z
      .string()
      .optional()
      .describe(
        'Working directory inside container. If not set - will use default',
      ),
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
      .describe('Initialization commands'),
    initScriptTimeoutMs: z
      .number()
      .positive()
      .optional()
      .describe(
        'Timeout in milliseconds for initialization script execution (default: 600000)',
      ),
    enableDind: z
      .boolean()
      .optional()
      .describe(
        'Enable Docker-in-Docker by creating a separate DIND container for this runtime',
      )
      .meta({ 'x-ui:show-on-node': true }),
  })
  .strict();

@Injectable()
@RegisterTemplate()
export class DockerRuntimeTemplate extends RuntimeNodeBaseTemplate<
  typeof DockerRuntimeTemplateSchema
> {
  readonly name = 'docker-runtime';
  readonly description = 'Docker runtime environment for executing code';
  readonly schema = DockerRuntimeTemplateSchema;

  constructor(private readonly runtimeProvider: RuntimeProvider) {
    super();
  }

  async create(
    config: z.infer<typeof DockerRuntimeTemplateSchema>,
    connectedNodes: Map<string, any>,
    metadata: NodeBaseTemplateMetadata,
  ): Promise<BaseRuntime> {
    // Automatically add graph_id and node_id labels for container management
    const systemLabels = {
      'ai-company/graph_id': metadata.graphId,
      'ai-company/node_id': metadata.nodeId,
    };

    // Merge user-provided labels with system labels (system labels take precedence)
    const mergedLabels = {
      ...config.labels,
      ...systemLabels,
    };

    // Generate network name based on graph ID if not provided
    const networkName = `ai-company-${metadata.graphId}`;

    return await this.runtimeProvider.provide({
      type: config.runtimeType,
      image: config.image,
      env: config.env,
      workdir: config.workdir,
      labels: mergedLabels,
      initScript: config.initScript,
      initScriptTimeoutMs: config.initScriptTimeoutMs,
      autostart: true, // Always start automatically
      containerName: `rt-${metadata.graphId}-${metadata.nodeId}`, // Use graphId and nodeId for consistent container naming
      network: networkName,
      enableDind: config.enableDind,
    });
  }
}
