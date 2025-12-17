import { TimestampsEntity } from '@packages/typeorm';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { MessageDto } from '../../graphs/dto/graphs.dto';
import type { MessageTokenUsage } from '../../litellm/litellm.types';

@Entity('messages')
export class MessageEntity extends TimestampsEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  threadId!: string;

  @Column({ type: 'varchar' })
  @Index()
  externalThreadId!: string;

  @Column({ type: 'varchar' })
  @Index()
  nodeId!: string;

  @Column({ type: 'jsonb' })
  message!: MessageDto;

  @Column({ type: 'jsonb', nullable: true })
  tokenUsage?: MessageTokenUsage;
}
