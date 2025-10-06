import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { RuntimeType } from '../../../runtime/runtime.types';
import { BaseRuntime } from '../../../runtime/services/base-runtime';
import { RuntimeProvider } from '../../../runtime/services/runtime-provider';
import { RegisterTemplate } from '../../decorators/register-template.decorator';
import { RuntimeNodeBaseTemplate } from '../base-node.template';

export const DockerRuntimeTemplateSchema = z.object({
  runtimeType: z.literal(RuntimeType.Docker),
  image: z.string().describe('Docker image to use'),
  workdir: z.string().optional().describe('Working directory inside container'),
  env: z
    .record(z.string(), z.string())
    .optional()
    .describe('Environment variables'),
  labels: z.record(z.string(), z.string()).optional().describe('Docker labels'),
  initScript: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe('Initialization commands'),
});

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
  ): Promise<BaseRuntime> {
    return await this.runtimeProvider.provide({
      type: config.runtimeType,
      image: config.image,
      env: config.env,
      workdir: config.workdir,
      labels: config.labels,
      initScript: config.initScript,
      autostart: true, // Always start automatically
    });
  }
}
