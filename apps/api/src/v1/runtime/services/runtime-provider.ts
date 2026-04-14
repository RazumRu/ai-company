import { Injectable, Optional } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';
import isEqual from 'lodash/isEqual';
import {
  adjectives,
  nouns,
  uniqueUsernameGenerator,
} from 'unique-username-generator';

import { environment } from '../../../environments';
import {
  IRuntimeStatusData,
  NotificationEvent,
} from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { RuntimeInstanceDao } from '../dao/runtime-instance.dao';
import { RuntimeInstanceEntity } from '../entity/runtime-instance.entity';
import {
  ProvideRuntimeInstanceParams,
  RuntimeInstanceStatus,
  RuntimeType,
} from '../runtime.types';
import { BaseRuntime } from './base-runtime';
import { DaytonaRuntime, DaytonaRuntimeConfig } from './daytona-runtime';
import { DockerRuntime } from './docker-runtime';
import { K8sRuntime } from './k8s-runtime';
import { K8sRuntimeConfig } from './k8s-runtime.types';
import { resolveK8sConfigFromEnv } from './k8s-runtime.utils';
import { K8sWarmPoolService } from './k8s-warm-pool.service';

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
    private readonly notificationsService: NotificationsService,
    @Optional()
    private readonly k8sWarmPoolService: K8sWarmPoolService | null = null,
  ) {}

  private emitRuntimeStatus(
    graphId: string | null | undefined,
    threadId: string,
    nodeId: string,
    runtimeId: string,
    status: IRuntimeStatusData['status'],
    runtimeType: string,
    message?: string,
  ): void {
    // System operations (e.g. repo indexing) have no graph — skip notifications.
    if (!graphId) {
      return;
    }

    this.notificationsService
      .emit({
        type: NotificationEvent.RuntimeStatus,
        graphId,
        threadId,
        nodeId,
        data: { runtimeId, threadId, nodeId, status, runtimeType, message },
      })
      .catch((error) => {
        this.logger.error(
          error as Error,
          'Failed to emit runtime status notification',
          { graphId, threadId, nodeId, runtimeId, status },
        );
      });
  }

  protected resolveRuntimeConfigByType(
    type: RuntimeType,
  ): Record<string, unknown> | undefined {
    switch (type) {
      case RuntimeType.Docker:
        return { socketPath: environment.dockerSocket };
      case RuntimeType.Daytona:
        return {
          apiKey: environment.daytonaApiKey,
          apiUrl: environment.daytonaApiUrl,
          target: environment.daytonaTarget,
        };
      case RuntimeType.K8s:
        return undefined;
    }
  }

  private resolveDaytonaConfig(): DaytonaRuntimeConfig {
    return {
      apiKey: environment.daytonaApiKey as string,
      apiUrl: environment.daytonaApiUrl as string,
      target: environment.daytonaTarget as string,
    };
  }

  private resolveK8sConfig(): K8sRuntimeConfig {
    return resolveK8sConfigFromEnv(environment);
  }

  protected resolveRuntimeByType(type: RuntimeType): BaseRuntime | undefined {
    switch (type) {
      case RuntimeType.Docker:
        return new DockerRuntime(this.resolveRuntimeConfigByType(type), {
          logger: this.logger,
        });
      case RuntimeType.Daytona:
        return new DaytonaRuntime(this.resolveDaytonaConfig(), {
          logger: this.logger,
        });
      case RuntimeType.K8s:
        return new K8sRuntime(this.resolveK8sConfig(), {
          logger: this.logger,
          warmPool: this.k8sWarmPoolService ?? null,
        });
    }
  }

  public getDefaultRuntimeType(): RuntimeType {
    const configured = environment.defaultRuntimeType;
    if (
      Boolean(configured) &&
      Object.values(RuntimeType).includes(configured as RuntimeType)
    ) {
      return configured as RuntimeType;
    }
    return RuntimeType.Daytona;
  }

  async provide<T extends BaseRuntime>(
    params: ProvideRuntimeInstanceParams,
  ): Promise<ProvideRuntimeResult<T>> {
    const { graphId = null, runtimeNodeId, threadId, type } = params;

    const existing = await this.runtimeInstanceDao.getOne({
      graphId,
      nodeId: runtimeNodeId,
      threadId,
      type,
    });

    if (existing) {
      if (existing.status === RuntimeInstanceStatus.Failed) {
        this.logger.warn(
          `Runtime instance ${existing.id} is in Failed status — cleaning up and recreating`,
        );
        await this.stopRuntime(existing);
        await this.runtimeInstanceDao.hardDeleteById(existing.id);
      } else {
        const runtimeConfig = params.runtimeStartParams;
        const configChanged = !isEqual(existing.config, runtimeConfig);

        if (configChanged) {
          await this.stopRuntime(existing);
          await this.runtimeInstanceDao.hardDeleteById(existing.id);
        } else {
          await this.runtimeInstanceDao.updateById(existing.id, {
            lastUsedAt: new Date(),
            config: runtimeConfig,
            temporary: params.temporary ?? false,
          });

          try {
            this.emitRuntimeStatus(
              graphId,
              threadId,
              runtimeNodeId,
              existing.id,
              'Starting',
              type,
            );
            const runtime = await this.ensureRuntimeForRecord<T>(existing);
            if (existing.status !== RuntimeInstanceStatus.Running) {
              await this.runtimeInstanceDao.updateById(existing.id, {
                status: RuntimeInstanceStatus.Running,
              });
            }

            this.emitRuntimeStatus(
              graphId,
              threadId,
              runtimeNodeId,
              existing.id,
              'Running',
              type,
            );
            return { runtime, cached: true };
          } catch (error) {
            await this.cleanupFailedInstance(existing);
            this.emitRuntimeStatus(
              graphId,
              threadId,
              runtimeNodeId,
              existing.id,
              'Failed',
              type,
              error instanceof Error ? error.message : String(error),
            );
            throw error;
          }
        }
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

    this.emitRuntimeStatus(
      graphId,
      threadId,
      runtimeNodeId,
      created.id,
      'Starting',
      type,
    );

    let runtime: T;
    try {
      runtime = await this.ensureRuntimeForRecord<T>(created);
    } catch (error) {
      await this.cleanupFailedInstance(created);
      this.emitRuntimeStatus(
        graphId,
        threadId,
        runtimeNodeId,
        created.id,
        'Failed',
        type,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }

    await this.runtimeInstanceDao.updateById(created.id, {
      status: RuntimeInstanceStatus.Running,
      lastUsedAt: new Date(),
    });

    this.emitRuntimeStatus(
      graphId,
      threadId,
      runtimeNodeId,
      created.id,
      'Running',
      type,
    );
    return { runtime, cached: false };
  }

  async stopRuntime(instance: RuntimeInstanceEntity): Promise<void> {
    await this.runtimeInstanceDao.updateById(instance.id, {
      status: RuntimeInstanceStatus.Stopping,
    });

    this.emitRuntimeStatus(
      instance.graphId,
      instance.threadId,
      instance.nodeId,
      instance.id,
      'Stopping',
      instance.type,
    );

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
          break;
        case RuntimeType.Daytona:
          await DaytonaRuntime.stopByName(
            instance.containerName,
            this.resolveDaytonaConfig(),
          ).catch(() => undefined);
          break;
        case RuntimeType.K8s:
          await K8sRuntime.stopByName(
            instance.containerName,
            this.resolveK8sConfig(),
          ).catch(() => undefined);
          break;
      }
    }

    await this.runtimeInstanceDao.updateById(instance.id, {
      status: RuntimeInstanceStatus.Stopped,
    });

    this.emitRuntimeStatus(
      instance.graphId,
      instance.threadId,
      instance.nodeId,
      instance.id,
      'Stopped',
      instance.type,
    );
  }

  async cleanupIdleRuntimes(idleThresholdMs: number): Promise<number> {
    const lastUsedBefore = new Date(Date.now() - idleThresholdMs);
    const instances = await this.runtimeInstanceDao.getAll({
      lastUsedAt: { $lt: lastUsedBefore },
      status: {
        $in: [
          RuntimeInstanceStatus.Running,
          RuntimeInstanceStatus.Starting,
          RuntimeInstanceStatus.Failed,
        ],
      },
    });

    return this.stopAndDeleteInstances(instances);
  }

  async cleanupRuntimesByNodeId(nodeId: string): Promise<number> {
    const instances = await this.runtimeInstanceDao.getAll({
      nodeId,
    });

    return this.stopAndDeleteInstances(instances);
  }

  async cleanupTemporaryRuntimes(): Promise<number> {
    // Only cleanup temporary containers that haven't been used in the last 10 minutes
    // This prevents cleanup of actively running temporary containers (e.g., repo indexing)
    const TEMPORARY_ACTIVE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
    const lastUsedBefore = new Date(Date.now() - TEMPORARY_ACTIVE_THRESHOLD_MS);

    const instances = await this.runtimeInstanceDao.getAll({
      temporary: true,
      lastUsedAt: { $lt: lastUsedBefore },
    });

    return this.stopAndDeleteInstances(instances);
  }

  private async stopAndDeleteInstances(
    instances: RuntimeInstanceEntity[],
  ): Promise<number> {
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
    graphId?: string | null;
    runtimeNodeId: string;
    threadId: string;
    type: RuntimeType;
  }): Promise<void> {
    const instance = await this.runtimeInstanceDao.getOne({
      graphId: params.graphId ?? null,
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

  private async cleanupFailedInstance(
    instance: RuntimeInstanceEntity,
  ): Promise<void> {
    try {
      await this.stopRuntime(instance);
    } catch (error) {
      this.logger.warn(
        `Failed to stop errored runtime ${instance.id} (${instance.containerName}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
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
      ...(record.graphId ? { 'geniro/graph_id': record.graphId } : {}),
      'geniro/node_id': record.nodeId,
      'geniro/thread_id': record.threadId,
      'geniro/instance_id': record.id,
      'geniro/type': 'runtime',
    };
    if (record.temporary) {
      labels['geniro/temporary'] = 'true';
    }

    await runtime.start({
      ...(record.config || {}),
      network: record.graphId ? `geniro-${record.graphId}` : undefined,
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
