import { Injectable } from '@nestjs/common';
import { NotFoundException } from '@packages/common';

import { ThreadTokenUsageCacheService } from '../../../cache/services/thread-token-usage-cache.service';
import { GraphDao } from '../../../graphs/dao/graph.dao';
import type { TokenUsage } from '../../../litellm/litellm.types';
import {
  IAgentStateUpdateNotification,
  NotificationEvent,
} from '../../../notifications/notifications.types';
import {
  EnrichedNotificationEvent,
  IEnrichedNotification,
  NotificationScope,
} from '../../notification-handlers.types';
import { BaseNotificationHandler } from './base-notification-handler';

export interface IAgentStateUpdateEnrichedNotification extends IEnrichedNotification<
  IAgentStateUpdateNotification['data']
> {
  type: EnrichedNotificationEvent.AgentStateUpdate;
  nodeId: string;
  threadId: string;
}

@Injectable()
export class AgentStateUpdateNotificationHandler extends BaseNotificationHandler<IAgentStateUpdateEnrichedNotification> {
  readonly pattern = NotificationEvent.AgentStateUpdate;
  private readonly graphOwnerCache = new Map<string, string>();

  constructor(
    private readonly graphDao: GraphDao,
    private readonly threadTokenUsageCacheService: ThreadTokenUsageCacheService,
  ) {
    super();
  }

  async handle(
    event: IAgentStateUpdateNotification,
  ): Promise<IAgentStateUpdateEnrichedNotification[]> {
    const { threadId, parentThreadId, graphId, data, nodeId } = event;
    // Some emitters historically used a sentinel 'unknown' string for missing parent thread id.
    // Treat it as missing to avoid persisting token/cost usage under a bogus Redis key.
    const externalThreadKey =
      parentThreadId && parentThreadId !== 'unknown'
        ? parentThreadId
        : threadId;

    // Get graph owner for enriching notification
    const ownerId = await this.getGraphOwner(graphId);

    // Best-effort: persist per-node token usage into Redis
    const patch: Partial<TokenUsage> = {
      ...(data.inputTokens !== undefined
        ? { inputTokens: data.inputTokens }
        : {}),
      ...(data.cachedInputTokens !== undefined
        ? { cachedInputTokens: data.cachedInputTokens }
        : {}),
      ...(data.outputTokens !== undefined
        ? { outputTokens: data.outputTokens }
        : {}),
      ...(data.reasoningTokens !== undefined
        ? { reasoningTokens: data.reasoningTokens }
        : {}),
      ...(data.totalTokens !== undefined
        ? { totalTokens: data.totalTokens }
        : {}),
      ...(data.totalPrice !== undefined ? { totalPrice: data.totalPrice } : {}),
      ...(data.currentContext !== undefined
        ? { currentContext: data.currentContext }
        : {}),
    };

    await this.threadTokenUsageCacheService.upsertNodeTokenUsage(
      externalThreadKey,
      nodeId,
      patch,
    );

    const notifications: IAgentStateUpdateEnrichedNotification[] = [];

    const agentStateNotification: IAgentStateUpdateEnrichedNotification = {
      type: EnrichedNotificationEvent.AgentStateUpdate,
      graphId,
      ownerId,
      nodeId,
      threadId: externalThreadKey,
      data,
      scope: [NotificationScope.Graph],
    };

    notifications.push(agentStateNotification);

    // All thread updates (status, name) are now centralized in graph-state-manager
    return notifications;
  }

  private async getGraphOwner(graphId: string): Promise<string> {
    // Check cache first
    if (this.graphOwnerCache.has(graphId)) {
      return this.graphOwnerCache.get(graphId)!;
    }

    // Fetch from database
    const graph = await this.graphDao.getOne({ id: graphId });

    if (!graph) {
      throw new NotFoundException('GRAPH_NOT_FOUND');
    }

    // Cache the result
    this.graphOwnerCache.set(graphId, graph.createdBy);

    return graph.createdBy;
  }
}
