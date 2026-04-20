import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';
import { BaseDao } from '@packages/mikroorm';

import { RuntimeInstanceEntity } from '../entity/runtime-instance.entity';
import {
  RuntimeErrorCode,
  RuntimeInstanceStatus,
  RuntimeStartingPhase,
} from '../runtime.types';
import { assertTransition } from '../services/runtime-state-machine.utils';

export interface TransitionStatusExtras {
  startingPhase?: RuntimeStartingPhase | null;
  lastError?: string | null;
  errorCode?: RuntimeErrorCode | null;
  lastUsedAt?: Date;
}

const POST_STARTING_STATUSES: ReadonlySet<RuntimeInstanceStatus> = new Set([
  RuntimeInstanceStatus.Running,
  RuntimeInstanceStatus.Stopped,
  RuntimeInstanceStatus.Failed,
]);

@Injectable()
export class RuntimeInstanceDao extends BaseDao<RuntimeInstanceEntity> {
  constructor(em: EntityManager) {
    super(em, RuntimeInstanceEntity);
  }

  async transitionStatus(
    id: string,
    next: RuntimeInstanceStatus,
    extras: TransitionStatusExtras = {},
    txEm?: EntityManager,
  ): Promise<RuntimeInstanceEntity> {
    const em = txEm ?? this.em;
    const entity = await em.findOne(RuntimeInstanceEntity, { id });
    if (!entity) {
      throw new NotFoundException('RUNTIME_INSTANCE_NOT_FOUND', { id });
    }

    if (entity.status !== next) {
      assertTransition(entity.status, next);
      entity.status = next;
    } else {
      const noExtrasProvided = Object.values(extras).every(
        (value) => value === undefined,
      );
      if (noExtrasProvided) {
        return entity;
      }
    }

    if (extras.startingPhase !== undefined) {
      entity.startingPhase = extras.startingPhase;
    }
    if (extras.lastError !== undefined) {
      entity.lastError = extras.lastError;
    }
    if (extras.errorCode !== undefined) {
      entity.errorCode = extras.errorCode;
    }
    if (extras.lastUsedAt !== undefined) {
      entity.lastUsedAt = extras.lastUsedAt;
    }

    if (
      POST_STARTING_STATUSES.has(next) ||
      next === RuntimeInstanceStatus.Stopping
    ) {
      entity.startingPhase = null;
    }

    if (next !== RuntimeInstanceStatus.Failed) {
      if (extras.lastError === undefined) {
        entity.lastError = null;
      }
      if (extras.errorCode === undefined) {
        entity.errorCode = null;
      }
    }

    await em.flush();
    return entity;
  }
}
