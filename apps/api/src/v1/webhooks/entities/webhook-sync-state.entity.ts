import {
  Entity,
  Enum,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { TimestampsEntity } from '@packages/mikroorm';

import { WebhookSubscriberType } from '../webhooks.types';

@Entity({ tableName: 'webhook_sync_state' })
export class WebhookSyncStateEntity extends TimestampsEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Unique()
  @Enum({ items: () => WebhookSubscriberType })
  type!: WebhookSubscriberType;

  @Property({ type: 'timestamptz' })
  lastSyncDate!: Date;
}
