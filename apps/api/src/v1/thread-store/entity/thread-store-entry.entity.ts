import {
  Entity,
  Enum,
  Filter,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

import { AuditEntity } from '../../../auth/audit.entity';
import { ThreadEntity } from '../../threads/entity/thread.entity';
import { ThreadStoreEntryMode } from '../thread-store.types';

@Entity({ tableName: 'thread_store_entries' })
@Filter({ name: 'softDelete', cond: { deletedAt: null }, default: true })
@Index({
  name: 'thread_store_entries_thread_ns_idx',
  properties: ['threadId', 'namespace'],
})
export class ThreadStoreEntryEntity extends AuditEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @ManyToOne(() => ThreadEntity, { deleteRule: 'cascade' })
  thread!: ThreadEntity;

  @Property({ type: 'uuid' })
  threadId!: string;

  @Property({ type: 'string', length: 128 })
  namespace!: string;

  @Property({ type: 'string', length: 256 })
  key!: string;

  @Property({ type: 'jsonb' })
  value!: unknown;

  @Enum({ items: () => ThreadStoreEntryMode })
  mode!: ThreadStoreEntryMode;

  @Property({ type: 'string', length: 128, nullable: true })
  authorAgentId!: string | null;

  @Property({ type: 'array', columnType: 'text[]', nullable: true })
  tags!: string[] | null;
}
