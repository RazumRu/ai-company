import { Collection } from '@mikro-orm/core';
import {
  Entity,
  Enum,
  Index,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';

import { AuditEntity } from '../../../auth/audit.entity';
import { ThreadEntity } from '../../threads/entity/thread.entity';
import {
  type GraphAgentInfo,
  type GraphSchemaType,
  type GraphSettings,
  GraphStatus,
} from '../graphs.types';

@Entity({ tableName: 'graphs' })
export class GraphEntity extends AuditEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string;

  @OneToMany(() => ThreadEntity, (t) => t.graph)
  threads?: Collection<ThreadEntity>;

  @Property({ type: 'varchar', length: 255 })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description?: string;

  @Property({ type: 'text', nullable: true })
  error?: string;

  @Property({ type: 'varchar', length: 50 })
  version!: string;

  @Property({ type: 'varchar', length: 50 })
  targetVersion!: string;

  @Property({ type: 'jsonb' })
  schema!: GraphSchemaType;

  @Enum({ items: () => GraphStatus, default: GraphStatus.Created })
  @Index()
  status!: GraphStatus;

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Property({ type: 'jsonb', default: '{}' })
  settings!: GraphSettings;

  @Property({ type: 'jsonb', nullable: true })
  agents?: GraphAgentInfo[] | null;

  @Property({ type: 'boolean', default: false })
  temporary!: boolean;
}
