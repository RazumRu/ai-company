import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { AuthContextStorage } from '@packages/http-server';

import { ThreadsDao } from '../../threads/dao/threads.dao';
import { RuntimeInstanceDao } from '../dao/runtime-instance.dao';
import {
  GetRuntimesQueryDto,
  RuntimeInstanceDto,
} from '../dto/runtime.dto';
import { RuntimeInstanceEntity } from '../entity/runtime-instance.entity';

@Injectable()
export class RuntimeService {
  constructor(
    private readonly runtimeInstanceDao: RuntimeInstanceDao,
    private readonly threadsDao: ThreadsDao,
  ) {}

  async getRuntimesForThread(
    ctx: AuthContextStorage,
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

  private toDto(instance: RuntimeInstanceEntity): RuntimeInstanceDto {
    return {
      id: instance.id,
      graphId: instance.graphId,
      nodeId: instance.nodeId,
      externalThreadId: instance.threadId,
      type: instance.type,
      status: instance.status,
      containerName: instance.containerName,
      lastUsedAt: instance.lastUsedAt.toISOString(),
      createdAt: instance.createdAt.toISOString(),
      updatedAt: instance.updatedAt.toISOString(),
    };
  }
}
