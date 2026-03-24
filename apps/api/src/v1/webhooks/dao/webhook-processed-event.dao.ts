import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource } from 'typeorm';

import { WebhookProcessedEventEntity } from '../entities/webhook-processed-event.entity';

type WebhookProcessedEventSearchTerms = {
  dedupKey?: string;
};

@Injectable()
export class WebhookProcessedEventDao extends BaseDao<
  WebhookProcessedEventEntity,
  WebhookProcessedEventSearchTerms
> {
  public get alias() {
    return 'wpe';
  }

  protected get entity() {
    return WebhookProcessedEventEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<WebhookProcessedEventEntity>,
    params?: WebhookProcessedEventSearchTerms,
  ): void {
    if (params?.dedupKey) {
      builder.andWhere({ dedupKey: params.dedupKey });
    }
  }

  async exists(dedupKey: string): Promise<boolean> {
    const count = await this.count({ dedupKey });
    return count > 0;
  }

  async markProcessed(dedupKey: string): Promise<void> {
    await this.upsertMany([{ dedupKey }], ['dedupKey']);
  }
}
