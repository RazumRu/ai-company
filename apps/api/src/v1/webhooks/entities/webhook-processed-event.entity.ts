import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { TimestampsEntity } from '@packages/mikroorm';

@Entity({ tableName: 'webhook_processed_event' })
export class WebhookProcessedEventEntity extends TimestampsEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Unique()
  @Property({ type: 'varchar' })
  dedupKey!: string;
}
