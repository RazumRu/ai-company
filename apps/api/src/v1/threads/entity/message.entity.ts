import {
  Entity,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { TimestampsEntity } from '@packages/mikroorm';

import type { MessageDto } from '../../graphs/dto/graphs.dto';
import { MessageRole } from '../../graphs/graphs.types';
import type { RequestTokenUsage } from '../../litellm/litellm.types';
import { ThreadEntity } from './thread.entity';

@Entity({ tableName: 'messages' })
export class MessageEntity extends TimestampsEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'uuid' })
  @Index()
  threadId!: string;

  @ManyToOne(() => ThreadEntity, { deleteRule: 'cascade', nullable: true })
  thread?: ThreadEntity;

  @Property({ type: 'varchar' })
  @Index()
  externalThreadId!: string;

  @Property({ type: 'varchar' })
  @Index()
  nodeId!: string;

  @Property({ type: 'jsonb' })
  message!: MessageDto;

  @Property({ type: 'jsonb', nullable: true })
  requestTokenUsage?: RequestTokenUsage;

  @Property({ type: 'varchar', nullable: true })
  role?: MessageRole;

  @Property({ type: 'varchar', nullable: true })
  name?: string;

  @Property({ type: 'array', columnType: 'text[]', nullable: true })
  toolCallNames?: string[];

  @Property({ type: 'array', columnType: 'text[]', nullable: true })
  answeredToolCallNames?: string[];

  @Property({ type: 'array', columnType: 'text[]', nullable: true })
  toolCallIds?: string[];

  @Property({ type: 'jsonb', nullable: true })
  additionalKwargs?: Record<string, unknown>;

  @Property({ type: 'jsonb', nullable: true })
  toolTokenUsage?: RequestTokenUsage;
}
