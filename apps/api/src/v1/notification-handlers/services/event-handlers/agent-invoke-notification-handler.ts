import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DefaultLogger } from '@packages/common';
import { isObject } from 'lodash';
import type { JsonObject } from 'type-fest';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IAgentInvokeNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadEntity } from '../../../threads/entity/thread.entity';
import { ThreadNameGeneratorService } from '../../../threads/services/thread-name-generator.service';
import { ThreadsService } from '../../../threads/services/threads.service';
import { ThreadStatus } from '../../../threads/threads.types';
import { BaseNotificationHandler } from './base-notification-handler';

@Injectable()
export class AgentInvokeNotificationHandler extends BaseNotificationHandler<never> {
  readonly pattern = NotificationEvent.AgentInvoke;

  constructor(
    private readonly threadDao: ThreadsDao,
    private readonly graphDao: GraphDao,
    private readonly notificationsService: NotificationsService,
    private readonly moduleRef: ModuleRef,
    private readonly threadNameGenerator: ThreadNameGeneratorService,
    private readonly logger: DefaultLogger,
  ) {
    super();
  }

  async handle(event: IAgentInvokeNotification): Promise<never[]> {
    const { threadId, graphId, parentThreadId, source, runId } = event;

    // Get graph to extract createdBy
    const graph = await this.graphDao.getOne({ id: graphId });
    if (!graph) {
      return [];
    }

    // Determine external thread key: prefer parentThreadId, fallback to current threadId
    const externalThreadKey = parentThreadId ?? threadId;
    const isRootThreadExecution = threadId === externalThreadKey;

    // Check if internal thread already exists
    const existingInternalThread = await this.threadDao.getOne({
      externalThreadId: externalThreadKey,
      graphId,
    });

    if (!existingInternalThread) {
      const createdThread = await this.threadDao.create({
        graphId,
        createdBy: graph.createdBy,
        externalThreadId: externalThreadKey,
        source,
        status: ThreadStatus.Running,
        ...(runId ? { lastRunId: runId } : {}),
      });

      // Emit ThreadCreate notification
      await this.notificationsService.emit({
        type: NotificationEvent.ThreadCreate,
        graphId,
        threadId: externalThreadKey,
        internalThreadId: createdThread.id,
        data: createdThread,
      });

      // Generate thread name asynchronously (must not block thread creation notifications)
      if (isRootThreadExecution) {
        void this.generateAndEmitThreadName(event, externalThreadKey).catch(
          (err: unknown) => {
            const normalizedMessage =
              err instanceof Error ? err.message : String(err);
            this.logger.error(
              err instanceof Error ? err : new Error(normalizedMessage),
              `thread-name-generation.error: ${normalizedMessage}`,
            );
          },
        );
      }
    } else {
      const updates: Partial<
        Pick<ThreadEntity, 'status' | 'source' | 'lastRunId'>
      > = {};

      if (existingInternalThread.status !== ThreadStatus.Running) {
        updates.status = ThreadStatus.Running;
      }

      if (source && !existingInternalThread.source) {
        updates.source = source;
      }

      if (runId && existingInternalThread.lastRunId !== runId) {
        updates.lastRunId = runId;
      }

      const hasUpdates = Object.keys(updates).length > 0;

      if (hasUpdates) {
        await this.threadDao.updateById(existingInternalThread.id, updates);
      } else {
        await this.threadDao.touchById(existingInternalThread.id);
      }

      if (hasUpdates) {
        const refreshedThread = await this.threadDao.getOne({
          id: existingInternalThread.id,
          graphId,
        });

        if (refreshedThread) {
          const threadsService = await this.moduleRef.create(ThreadsService);
          const threadDto =
            await threadsService.prepareThreadResponse(refreshedThread);

          await this.notificationsService.emit({
            type: NotificationEvent.ThreadUpdate,
            graphId,
            threadId: externalThreadKey,
            parentThreadId,
            data: threadDto,
          });
        }
      }

      // Best-effort: if a root thread exists but still has no name, try generating it once.
      // This avoids expensive LLM calls for nested (child) agent executions.
      if (
        isRootThreadExecution &&
        !existingInternalThread.name &&
        !hasUpdates // keep this path lightweight when we're already doing DB work
      ) {
        void this.generateAndEmitThreadName(event, externalThreadKey).catch(
          (err: unknown) => {
            const normalizedMessage =
              err instanceof Error ? err.message : String(err);
            this.logger.error(
              err instanceof Error ? err : new Error(normalizedMessage),
              `thread-name-generation.error: ${normalizedMessage}`,
            );
          },
        );
      }
    }

    return [];
  }

  private async generateAndEmitThreadName(
    event: IAgentInvokeNotification,
    externalThreadKey: string,
  ): Promise<void> {
    const firstHuman = event.data.messages.find((m) => {
      if (!isObject(m)) {
        return false;
      }

      const id = (m as unknown as JsonObject).id;

      // Handle LangChain serialized message format: { id: [..., ..., 'HumanMessage'], kwargs: { content } }
      if (Array.isArray(id) && typeof id[2] === 'string') {
        return id[2] === 'HumanMessage';
      }

      // Handle best-effort plain shapes (rare but possible)
      return (m as unknown as JsonObject).type === 'human';
    });

    if (!firstHuman) {
      return;
    }

    const firstHumanJson = firstHuman as unknown as JsonObject;
    const rawContent =
      Array.isArray(firstHumanJson.id) &&
      typeof firstHumanJson.id[2] === 'string' &&
      isObject(firstHumanJson.kwargs)
        ? (firstHumanJson.kwargs as JsonObject).content
        : firstHumanJson.content;

    const userInput =
      typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

    const name =
      await this.threadNameGenerator.generateFromFirstUserMessage(userInput);

    if (!name) {
      return;
    }

    await this.notificationsService.emit({
      type: NotificationEvent.ThreadUpdate,
      graphId: event.graphId,
      nodeId: event.nodeId,
      threadId: externalThreadKey,
      parentThreadId: externalThreadKey,
      data: { name },
    });
  }
}
