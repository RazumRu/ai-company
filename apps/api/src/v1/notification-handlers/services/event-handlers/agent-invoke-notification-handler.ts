import { HumanMessage } from '@langchain/core/messages';
import { Injectable } from '@nestjs/common';
import { DefaultLogger } from '@packages/common';

import { GraphDao } from '../../../graphs/dao/graph.dao';
import {
  IAgentInvokeNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import { NotificationsService } from '../../../notifications/services/notifications.service';
import { ThreadsDao } from '../../../threads/dao/threads.dao';
import { ThreadNameGeneratorService } from '../../../threads/services/thread-name-generator.service';
import { ThreadsService } from '../../../threads/services/threads.service';
import { ThreadStatus } from '../../../threads/threads.types';
import { BaseNotificationHandler } from './base-notification-handler';

/**
 * Handles AgentInvoke notifications by creating or updating internal threads.
 *
 * NOTE: This handler is a side-effect handler -- it does NOT produce enriched
 * notifications for the WebSocket gateway. Instead, it performs DB operations
 * (thread creation/update) and re-emits new ThreadCreate / ThreadUpdate
 * notifications back into the NotificationsService queue.
 */
@Injectable()
export class AgentInvokeNotificationHandler extends BaseNotificationHandler<never> {
  readonly pattern = NotificationEvent.AgentInvoke;

  constructor(
    private readonly threadDao: ThreadsDao,
    private readonly graphDao: GraphDao,
    private readonly notificationsService: NotificationsService,
    private readonly threadsService: ThreadsService,
    private readonly threadNameGenerator: ThreadNameGeneratorService,
    private readonly logger: DefaultLogger,
  ) {
    super();
  }

  async handle(event: IAgentInvokeNotification): Promise<never[]> {
    const { threadId, graphId, parentThreadId, source, runId, threadMetadata } =
      event;

    const graph = await this.graphDao.getOne({ id: graphId });
    if (!graph) {
      return [];
    }

    const externalThreadKey = parentThreadId ?? threadId;
    const isRootThreadExecution = threadId === externalThreadKey;

    // Upsert: INSERT or ON CONFLICT(externalThreadId) UPDATE status/source/lastRunId.
    // This eliminates the race condition between executeTrigger (eager thread creation)
    // and this handler — both can safely write without 23505 unique violations.
    await this.threadDao.upsertByExternalThreadId({
      graphId,
      createdBy: graph.createdBy,
      projectId: graph.projectId,
      externalThreadId: externalThreadKey,
      status: ThreadStatus.Running,
      ...(source ? { source } : {}),
      ...(runId ? { lastRunId: runId } : {}),
      ...(threadMetadata ? { metadata: threadMetadata } : {}),
    });

    // Fetch the full entity after upsert to get all fields (including name, metadata
    // that are not overwritten on conflict).
    const thread = await this.threadDao.getOne({
      externalThreadId: externalThreadKey,
      graphId,
    });

    if (!thread) {
      this.logger.error(
        new Error('Thread missing after upsert'),
        `Thread not found after upsert for externalThreadId=${externalThreadKey}, graphId=${graphId}`,
      );
      return [];
    }

    // A thread without a name was just created (either by this upsert or by the
    // eager path in executeTrigger). Emit ThreadCreate so the frontend picks it up.
    // A thread with a name already existed — emit ThreadUpdate with current state.
    if (!thread.name) {
      await this.notificationsService.emit({
        type: NotificationEvent.ThreadCreate,
        graphId,
        projectId: graph.projectId,
        threadId: externalThreadKey,
        internalThreadId: thread.id,
        data: thread,
      });
    } else {
      const threadDto = this.threadsService.prepareThreadResponse(thread);
      await this.notificationsService.emit({
        type: NotificationEvent.ThreadUpdate,
        graphId,
        projectId: graph.projectId,
        threadId: externalThreadKey,
        parentThreadId,
        data: threadDto,
      });
    }

    // Generate thread name for root thread executions that don't have one yet.
    if (isRootThreadExecution && !thread.name) {
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

    return [];
  }

  private async generateAndEmitThreadName(
    event: IAgentInvokeNotification,
    externalThreadKey: string,
  ): Promise<void> {
    const firstHuman = event.data.messages.find(
      (m) => m instanceof HumanMessage,
    );

    if (!firstHuman) {
      return;
    }

    const rawContent = firstHuman.content;

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
