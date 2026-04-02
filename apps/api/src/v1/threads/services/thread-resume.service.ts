import { HumanMessage } from '@langchain/core/messages';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DefaultLogger } from '@packages/common';

import { SimpleAgent } from '../../agents/services/agents/simple-agent';
import { GraphRegistry } from '../../graphs/services/graph-registry';
import { NotificationEvent } from '../../notifications/notifications.types';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { ThreadsDao } from '../dao/threads.dao';
import type { ThreadWaitingEvent } from '../threads.types';
import { THREAD_WAITING_EVENT, ThreadStatus } from '../threads.types';
import { clearWaitMetadata } from '../threads.utils';
import {
  ThreadResumeJobData,
  ThreadResumeQueueService,
} from './thread-resume-queue.service';

@Injectable()
export class ThreadResumeService implements OnModuleInit {
  constructor(
    private readonly queueService: ThreadResumeQueueService,
    private readonly threadsDao: ThreadsDao,
    private readonly graphRegistry: GraphRegistry,
    private readonly notificationsService: NotificationsService,
    private readonly logger: DefaultLogger,
  ) {}

  onModuleInit(): void {
    this.queueService.setCallbacks({
      onProcess: (data) => this.handleResume(data),
      onFailed: (data, error) => this.handleResumeFailed(data, error),
    });
  }

  @OnEvent(THREAD_WAITING_EVENT)
  async onThreadWaiting(event: ThreadWaitingEvent): Promise<void> {
    const thread = await this.threadsDao.getOne({
      graphId: event.graphId,
      externalThreadId: event.threadId,
    });

    if (!thread) {
      this.logger.warn('Thread not found for waiting event', {
        graphId: event.graphId,
        externalThreadId: event.threadId,
      });
      return;
    }

    const scheduledAt = new Date(
      Date.now() + event.durationSeconds * 1000,
    ).toISOString();

    await this.threadsDao.updateById(thread.id, {
      metadata: {
        ...thread.metadata,
        scheduledResumeAt: scheduledAt,
        waitReason: event.reason,
        waitNodeId: event.nodeId,
        waitCheckPrompt: event.checkPrompt,
      },
    });

    await this.notificationsService.emit({
      type: NotificationEvent.ThreadUpdate,
      graphId: event.graphId,
      threadId: thread.externalThreadId,
      data: {
        status: ThreadStatus.Waiting,
        scheduledResumeAt: scheduledAt,
        waitReason: event.reason,
      },
    });

    await this.queueService.scheduleResume(
      {
        threadId: thread.id,
        graphId: event.graphId,
        nodeId: event.nodeId,
        externalThreadId: thread.externalThreadId,
        checkPrompt: event.checkPrompt,
        reason: event.reason,
        scheduledAt,
        createdBy: thread.createdBy,
      },
      event.durationSeconds * 1000,
    );

    this.logger.debug('Scheduled thread resume', {
      threadId: thread.id,
      graphId: event.graphId,
      durationSeconds: event.durationSeconds,
    });
  }

  async handleResume(data: ThreadResumeJobData): Promise<void> {
    const thread = await this.threadsDao.getById(data.threadId);
    if (!thread) {
      this.logger.warn('Thread not found for resume', {
        threadId: data.threadId,
      });
      return;
    }

    if (thread.status !== ThreadStatus.Waiting) {
      this.logger.debug('Thread no longer in waiting state, skipping resume', {
        threadId: data.threadId,
        currentStatus: thread.status,
      });
      return;
    }

    const compiledGraph = this.graphRegistry.get(data.graphId);
    if (!compiledGraph) {
      this.logger.warn('Graph not running, cannot resume thread', {
        threadId: data.threadId,
        graphId: data.graphId,
      });
      await this.threadsDao.updateById(data.threadId, {
        status: ThreadStatus.Stopped,
        metadata: clearWaitMetadata(thread.metadata),
      });
      return;
    }

    const agentNode = compiledGraph.nodes.get(data.nodeId);
    if (!agentNode) {
      this.logger.warn('Agent node not found in graph, cannot resume thread', {
        threadId: data.threadId,
        graphId: data.graphId,
        nodeId: data.nodeId,
      });
      await this.threadsDao.updateById(data.threadId, {
        status: ThreadStatus.Stopped,
      });
      return;
    }

    if (!(agentNode.instance instanceof SimpleAgent)) {
      this.logger.warn('Node is not a SimpleAgent, cannot resume', {
        threadId: data.threadId,
        nodeId: data.nodeId,
      });
      await this.threadsDao.updateById(data.threadId, {
        status: ThreadStatus.Stopped,
      });
      return;
    }
    const agent = agentNode.instance;

    await this.threadsDao.updateById(data.threadId, {
      status: ThreadStatus.Running,
      metadata: clearWaitMetadata(thread.metadata),
    });

    await this.notificationsService.emit({
      type: NotificationEvent.ThreadUpdate,
      graphId: data.graphId,
      threadId: data.externalThreadId,
      data: {
        status: ThreadStatus.Running,
        scheduledResumeAt: undefined,
        waitReason: undefined,
      },
    });

    const resumeMessage = new HumanMessage(data.checkPrompt);

    await agent.run(data.externalThreadId, [resumeMessage], undefined, {
      configurable: {
        thread_id: data.externalThreadId,
        graph_id: data.graphId,
        node_id: data.nodeId,
        thread_created_by: data.createdBy,
      },
    });
  }

  async handleResumeFailed(
    data: ThreadResumeJobData,
    error: Error,
  ): Promise<void> {
    this.logger.error(error, 'Thread resume failed after all retries', {
      threadId: data.threadId,
      graphId: data.graphId,
    });

    const thread = await this.threadsDao.getById(data.threadId);

    await this.threadsDao.updateById(data.threadId, {
      status: ThreadStatus.Stopped,
      metadata: {
        ...clearWaitMetadata(thread?.metadata),
        resumeError: error.message,
      },
    });

    await this.notificationsService.emit({
      type: NotificationEvent.ThreadUpdate,
      graphId: data.graphId,
      threadId: data.externalThreadId,
      data: {
        status: ThreadStatus.Stopped,
      },
    });
  }

  /**
   * Cancel the pending resume job and immediately trigger a resume.
   */
  async resumeEarly(threadId: string, message?: string): Promise<void> {
    const thread = await this.threadsDao.getById(threadId);
    if (!thread) {
      throw new Error('Thread not found');
    }

    if (thread.status !== ThreadStatus.Waiting) {
      throw new Error('Thread is not in waiting state');
    }

    const metadata = thread.metadata as Record<string, unknown> | undefined;

    await this.queueService.cancelResumeJob(threadId);

    await this.handleResume({
      threadId: thread.id,
      graphId: thread.graphId,
      nodeId: (metadata?.waitNodeId as string) ?? '',
      externalThreadId: thread.externalThreadId,
      checkPrompt: message ?? (metadata?.waitCheckPrompt as string) ?? '',
      reason: (metadata?.waitReason as string) ?? '',
      scheduledAt: (metadata?.scheduledResumeAt as string) ?? '',
      createdBy: thread.createdBy,
    });
  }

  /**
   * Cancel the pending resume job and stop the thread.
   */
  async cancelWait(threadId: string): Promise<void> {
    const thread = await this.threadsDao.getById(threadId);
    if (!thread) {
      throw new Error('Thread not found');
    }

    if (thread.status !== ThreadStatus.Waiting) {
      throw new Error('Thread is not in waiting state');
    }

    await this.queueService.cancelResumeJob(threadId);

    await this.threadsDao.updateById(threadId, {
      status: ThreadStatus.Stopped,
      metadata: clearWaitMetadata(thread.metadata),
    });

    await this.notificationsService.emit({
      type: NotificationEvent.ThreadUpdate,
      graphId: thread.graphId,
      threadId: thread.externalThreadId,
      data: {
        status: ThreadStatus.Stopped,
      },
    });
  }
}
