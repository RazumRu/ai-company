import { Collection } from '@mikro-orm/core';
import {
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';

import { AuditEntity } from '../../../auth/audit.entity';
import { GraphEntity } from '../../graphs/entity/graph.entity';
import { ThreadStatus } from '../threads.types';
import { MessageEntity } from './message.entity';

@Entity({ tableName: 'threads' })
export class ThreadEntity extends AuditEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @Property({ type: 'uuid' })
  @Index()
  graphId!: string;

  @ManyToOne(() => GraphEntity, { deleteRule: 'cascade', nullable: true })
  graph?: GraphEntity;

  @OneToMany(() => MessageEntity, (m) => m.thread)
  messages?: Collection<MessageEntity>;

  @Property({ type: 'varchar' })
  @Unique()
  externalThreadId!: string;

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @Property({ type: 'varchar', nullable: true })
  source?: string;

  @Property({ type: 'varchar', nullable: true })
  name?: string;

  @Property({ type: 'varchar', default: ThreadStatus.Running })
  @Index()
  status!: ThreadStatus;

  @Property({ type: 'uuid', nullable: true })
  lastRunId?: string;
}
