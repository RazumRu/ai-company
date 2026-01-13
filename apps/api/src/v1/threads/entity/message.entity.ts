import { TimestampsEntity } from '@packages/typeorm';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

import type { MessageDto } from '../../graphs/dto/graphs.dto';
import { MessageRole } from '../../graphs/graphs.types';
import type { RequestTokenUsage } from '../../litellm/litellm.types';

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
  requestTokenUsage?: RequestTokenUsage;

  /**
   * Message role extracted from message.role for query performance
   * Used to determine if a message is a tool message without parsing full JSONB
   */
  @Column({ type: 'varchar', nullable: true })
  role?: MessageRole;

  /**
   * Tool/message name extracted from message.name for query performance
   * Used to aggregate statistics by tool without parsing full JSONB
   */
  @Column({ type: 'varchar', nullable: true })
  name?: string;

  /**
   * Array of tool names from message.toolCalls for AI messages
   * Used to identify AI messages with tool calls and aggregate by tool without parsing full JSONB
   * Only populated for AI messages that have toolCalls
   */
  @Column({ type: 'simple-array', nullable: true })
  toolCallNames?: string[];
}
