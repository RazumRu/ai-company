import { Injectable } from '@nestjs/common';
import { BaseDao, BaseQueryBuilder } from '@packages/typeorm';
import { DataSource } from 'typeorm';

import { WebhookSyncStateEntity } from '../entities/webhook-sync-state.entity';
import { type WebhookSubscriberType } from '../webhooks.types';

type WebhookSyncStateSearchTerms = {
  type?: WebhookSubscriberType;
};

@Injectable()
export class WebhookSyncStateDao extends BaseDao<
  WebhookSyncStateEntity,
  WebhookSyncStateSearchTerms
> {
  public get alias() {
    return 'wss';
  }

  protected get entity() {
    return WebhookSyncStateEntity;
  }

  constructor(dataSource: DataSource) {
    super(dataSource);
  }

  protected applySearchParams(
    builder: BaseQueryBuilder<WebhookSyncStateEntity>,
    params?: WebhookSyncStateSearchTerms,
  ): void {
    if (params?.type) {
      builder.andWhere({ type: params.type });
    }
  }

  async getLastSyncDate(type: WebhookSubscriberType): Promise<Date | null> {
    const record = await this.getOne({ type });
    return record?.lastSyncDate ?? null;
  }

  async upsertLastSyncDate(
    type: WebhookSubscriberType,
    date: Date,
  ): Promise<void> {
    await this.upsertMany([{ type, lastSyncDate: date }], ['type']);
  }
}
