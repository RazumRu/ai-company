import { EntityManager } from '@mikro-orm/postgresql';
import { Injectable } from '@nestjs/common';
import { BaseDao } from '@packages/mikroorm';

import { WebhookProcessedEventEntity } from '../entities/webhook-processed-event.entity';

@Injectable()
export class WebhookProcessedEventDao extends BaseDao<WebhookProcessedEventEntity> {
  constructor(em: EntityManager) {
    super(em, WebhookProcessedEventEntity);
  }

  async exists(dedupKey: string): Promise<boolean> {
    const count = await this.getRepo().count({ dedupKey });
    return count > 0;
  }

  async markProcessed(dedupKey: string): Promise<void> {
    await this.getRepo().upsert(
      { dedupKey },
      {
        onConflictFields: ['dedupKey'],
        onConflictAction: 'ignore',
      },
    );
  }
}
