import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { AppContextStorage } from '../../../auth/app-context-storage';
import { environment } from '../../../environments';
import { ThreadsDao } from '../../threads/dao/threads.dao';
import { RuntimeInstanceDao } from '../dao/runtime-instance.dao';
import {
  GetRuntimesQueryDto,
  RuntimeHealthDto,
  RuntimeInstanceDto,
} from '../dto/runtime.dto';
import { RuntimeInstanceEntity } from '../entity/runtime-instance.entity';
import { RuntimeType } from '../runtime.types';
import { DaytonaRuntime, DaytonaRuntimeConfig } from './daytona-runtime';
import { K8sRuntime } from './k8s-runtime';
import { resolveK8sConfigFromEnv } from './k8s-runtime.utils';

@Injectable()
export class RuntimeService {
  constructor(
    private readonly runtimeInstanceDao: RuntimeInstanceDao,
    private readonly threadsDao: ThreadsDao,
  ) {}

  async getRuntimesForThread(
    ctx: AppContextStorage,
    query: GetRuntimesQueryDto,
  ): Promise<RuntimeInstanceDto[]> {
    const userId = ctx.checkSub();

    const thread = await this.threadsDao.getOne({
      id: query.threadId,
      createdBy: userId,
    });

    if (!thread) {
      throw new NotFoundException('THREAD_NOT_FOUND');
    }

    const instances = await this.runtimeInstanceDao.getAll({
      threadId: thread.externalThreadId,
      ...(query.status ? { status: query.status } : {}),
    });

    return instances.map((inst) => this.toDto(inst));
  }

  async checkHealth(type: RuntimeType): Promise<RuntimeHealthDto> {
    if (type === RuntimeType.Daytona) {
      const config: DaytonaRuntimeConfig = {
        apiKey: environment.daytonaApiKey as string,
        apiUrl: environment.daytonaApiUrl as string,
        target: environment.daytonaTarget as string,
      };
      const result = await DaytonaRuntime.checkHealth(config);
      return { ...result, type };
    }

    if (type === RuntimeType.K8s) {
      const result = await K8sRuntime.checkHealth(
        resolveK8sConfigFromEnv(environment),
      );
      return { ...result, type };
    }

    // Docker runtime — no remote health check, always report healthy
    return { healthy: true, type };
  }

  private toDto(instance: RuntimeInstanceEntity): RuntimeInstanceDto {
    return {
      id: instance.id,
      graphId: instance.graphId,
      nodeId: instance.nodeId,
      externalThreadId: instance.threadId,
      type: instance.type,
      status: instance.status,
      containerName: instance.containerName,
      image: instance.config?.image || environment.dockerRuntimeImage,
      lastUsedAt: instance.lastUsedAt.toISOString(),
      createdAt: instance.createdAt.toISOString(),
      updatedAt: instance.updatedAt.toISOString(),
    };
  }
}
