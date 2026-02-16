import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import isEqual from 'lodash/isEqual';
import {
  adjectives,
  nouns,
  uniqueUsernameGenerator,
} from 'unique-username-generator';

import { environment } from '../../../environments';
import { RuntimeInstanceDao } from '../dao/runtime-instance.dao';
import { RuntimeInstanceEntity } from '../entity/runtime-instance.entity';
import {
  ProvideRuntimeInstanceParams,
  RuntimeInstanceStatus,
  RuntimeType,
} from '../runtime.types';
import { BaseRuntime } from './base-runtime';
import { DockerRuntime } from './docker-runtime';

export type ProvideRuntimeResult<T extends BaseRuntime> = {
  runtime: T;
  cached: boolean;
};

@Injectable()
export class RuntimeProvider {
  private readonly runtimeInstances = new Map<string, BaseRuntime>();

  constructor(
    private readonly runtimeInstanceDao: RuntimeInstanceDao,
    private readonly logger: DefaultLogger,
  ) {}

  protected resolveRuntimeConfigByType(
    type: RuntimeType,
  ): Record<string, unknown> | undefined {
    switch (type) {
      case RuntimeType.Docker:
        return { socketPath: environment.dockerSocket };
    }
  }

  protected resolveRuntimeByType(type: RuntimeType): BaseRuntime | undefined {
    const config = this.resolveRuntimeConfigByType(type);

    switch (type) {
      case RuntimeType.Docker:
        return new DockerRuntime(config, { logger: this.logger });
    }
  }

  async provide<T extends BaseRuntime>(
    params: ProvideRuntimeInstanceParams,
  ): Promise<ProvideRuntimeResult<T>> {
    const { graphId, runtimeNodeId, threadId, type } = params;

    const existing = await this.runtimeInstanceDao.getOne({
      graphId,
      nodeId: runtimeNodeId,
      threadId,
      type,
    });

    if (existing) {
      const runtimeConfig = params.runtimeStartParams;
      const configChanged = !isEqual(existing.config, runtimeConfig);

      if (configChanged) {
        await this.stopRuntime(existing);
        await this.runtimeInstanceDao.deleteById(existing.id);
      } else {
        await this.runtimeInstanceDao.updateById(existing.id, {
          lastUsedAt: new Date(),
          config: runtimeConfig,
          temporary: params.temporary,
        });

        const runtime = await this.ensureRuntimeForRecord<T>(existing);
        if (existing.status !== RuntimeInstanceStatus.Running) {
          await this.runtimeInstanceDao.updateById(existing.id, {
            status: RuntimeInstanceStatus.Running,
          });
        }

        return { runtime, cached: true };
      }
    }

    const containerName = this.buildContainerName();

    const created = await this.runtimeInstanceDao.create({
      graphId,
      nodeId: runtimeNodeId,
      threadId,
      type,
      containerName,
      status: RuntimeInstanceStatus.Starting,
      config: params.runtimeStartParams,
      temporary: params.temporary ?? false,
      lastUsedAt: new Date(),
    });

    const runtime = await this.ensureRuntimeForRecord<T>(created);

    await this.runtimeInstanceDao.updateById(created.id, {
      status: RuntimeInstanceStatus.Running,
      lastUsedAt: new Date(),
    });

    return { runtime, cached: false };
  }

  async stopRuntime(instance: RuntimeInstanceEntity): Promise<void> {
    await this.runtimeInstanceDao.updateById(instance.id, {
      status: RuntimeInstanceStatus.Stopping,
    });

    const runtime = this.runtimeInstances.get(instance.id);

    if (runtime) {
      await runtime.stop().catch(() => undefined);
      this.runtimeInstances.delete(instance.id);
    } else {
      const config = this.resolveRuntimeConfigByType(instance.type);

      switch (instance.type) {
        case RuntimeType.Docker:
          await DockerRuntime.stopByName(instance.containerName, config).catch(
            () => undefined,
          );
      }
    }

    await this.runtimeInstanceDao.updateById(instance.id, {
      status: RuntimeInstanceStatus.Stopped,
    });
  }

  async cleanupIdleRuntimes(idleThresholdMs: number): Promise<number> {
    const lastUsedBefore = new Date(Date.now() - idleThresholdMs);
    const instances = await this.runtimeInstanceDao.getAll({
      lastUsedBefore,
      statuses: [RuntimeInstanceStatus.Running, RuntimeInstanceStatus.Starting],
    });

    if (!instances.length) {
      return 0;
    }

    await Promise.all(
      instances.map(async (instance) => {
        await this.stopRuntime(instance);
        await this.runtimeInstanceDao.hardDeleteById(instance.id);
      }),
    );

    return instances.length;
  }

  async cleanupRuntimesByNodeId(params: {
    graphId: string;
    nodeId: string;
  }): Promise<number> {
    const instances = await this.runtimeInstanceDao.getAll({
      graphId: params.graphId,
      nodeId: params.nodeId,
    });

    if (!instances.length) {
      return 0;
    }

    await Promise.all(
      instances.map(async (instance) => {
        await this.stopRuntime(instance);
        await this.runtimeInstanceDao.hardDeleteById(instance.id);
      }),
    );

    return instances.length;
  }

  async cleanupTemporaryRuntimes(): Promise<number> {
    // Only cleanup temporary containers that haven't been used in the last 10 minutes
    // This prevents cleanup of actively running temporary containers (e.g., repo indexing)
    const TEMPORARY_ACTIVE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
    const lastUsedBefore = new Date(Date.now() - TEMPORARY_ACTIVE_THRESHOLD_MS);

    const instances = await this.runtimeInstanceDao.getAll({
      temporary: true,
      lastUsedBefore,
    });

    if (!instances.length) {
      return 0;
    }

    await Promise.all(
      instances.map(async (instance) => {
        await this.stopRuntime(instance);
        await this.runtimeInstanceDao.hardDeleteById(instance.id);
      }),
    );

    return instances.length;
  }

  async cleanupRuntimeInstance(params: {
    graphId: string;
    runtimeNodeId: string;
    threadId: string;
    type: RuntimeType;
  }): Promise<void> {
    const instance = await this.runtimeInstanceDao.getOne({
      graphId: params.graphId,
      nodeId: params.runtimeNodeId,
      threadId: params.threadId,
      type: params.type,
    });

    if (!instance) {
      return;
    }

    await this.stopRuntime(instance);
    await this.runtimeInstanceDao.hardDeleteById(instance.id);
  }

  private async ensureRuntimeForRecord<T extends BaseRuntime>(
    record: RuntimeInstanceEntity,
  ): Promise<T> {
    const cached = this.runtimeInstances.get(record.id);
    if (cached) {
      return <T>cached;
    }

    const runtime = this.resolveRuntimeByType(record.type);
    if (!runtime) {
      throw new Error(`Runtime ${record.type} is not supported`);
    }

    const registryMirrors = environment.dockerRegistryMirror
      ? [environment.dockerRegistryMirror as string]
      : undefined;
    const insecureRegistries = environment.dockerInsecureRegistry
      ? [environment.dockerInsecureRegistry as string]
      : undefined;
    const baseLabels = record.config.labels ?? {};
    const labels: Record<string, string> = {
      ...baseLabels,
      'ai-company/graph_id': record.graphId,
      'ai-company/node_id': record.nodeId,
      'ai-company/thread_id': record.threadId,
      'ai-company/instance_id': record.id,
      'ai-company/type': 'runtime',
    };
    if (record.temporary) {
      labels['ai-company/temporary'] = 'true';
    }

    await runtime.start({
      ...(record.config || {}),
      network: `ai-company-${record.graphId}`,
      registryMirrors,
      insecureRegistries,
      containerName: record.containerName,
      labels,
      recreate: false,
    });

    this.runtimeInstances.set(record.id, runtime);
    return <T>runtime;
  }

  private buildContainerName(): string {
    return uniqueUsernameGenerator({
      dictionaries: [adjectives, nouns],
      template: '{adjective}-{noun}-{digits:3}',
      style: 'lowerCase',
      length: 30,
    });
  }
}
