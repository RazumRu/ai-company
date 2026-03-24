import { TimestampsEntity } from '@packages/typeorm';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import { WebhookSubscriberType } from '../webhooks.types';

@Entity('webhook_sync_state')
export class WebhookSyncStateEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'enum', enum: WebhookSubscriberType })
  type!: WebhookSubscriberType;

  @Column({ type: 'timestamptz', name: 'last_sync_date' })
  lastSyncDate!: Date;
}
