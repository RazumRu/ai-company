import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { WebhookSyncStateEntity } from '../entities/webhook-sync-state.entity';
import { type WebhookSubscriberType } from '../webhooks.types';

@Injectable()
export class WebhookSyncStateDao extends BaseDao<WebhookSyncStateEntity> {
  constructor(em: EntityManager) {
    super(em, WebhookSyncStateEntity);
  }

  async getLastSyncDate(type: WebhookSubscriberType): Promise<Date | null> {
    const record = await this.getRepo().findOne({ type });
    return record?.lastSyncDate ?? null;
  }

  async upsertLastSyncDate(
    type: WebhookSubscriberType,
    date: Date,
  ): Promise<void> {
    await this.getRepo().upsert(
      { type, lastSyncDate: date },
      {
        onConflictFields: ['type'],
        onConflictAction: 'merge',
        onConflictMergeFields: ['lastSyncDate'],
      },
    );
  }
}
